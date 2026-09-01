import type { AppEnv } from "../types";
import { startOfWeek, endOfWeek, weekdayOf } from "../lib/dates";

export interface AdjacentClass {
  period: number;
  subject: string;
  class_name: string;
}

export interface Candidate {
  teacher_id: number;
  name: string;
  email: string;
  department: string;
  subjects: string;
  cluster: string;
  room: string;
  workload_this_week: number;
  total_relief_periods: number;
  score: number;
  schedule_before: AdjacentClass | null;
  schedule_after: AdjacentClass | null;
}

const ACTIVE_STATUS = "('assigned', 'accepted', 'overridden')";

/**
 * Runs a query once per chunk of ids (D1 caps bound params), aggregating results.
 * `mapRow` normalizes each row to {key, value}; rows with no value are skipped.
 */
async function queryChunked<T extends { key: number; value: number | string | null }>(
  db: D1Database,
  sqlPrefix: string,
  sqlSuffix: string,
  ids: number[],
  extraParams: (string | number)[],
  mapRow: (row: Record<string, unknown>) => T,
  chunkSize = 50
): Promise<Map<number, T["value"]>> {
  const out = new Map<number, T["value"]>();
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(`${sqlPrefix} IN (${placeholders})${sqlSuffix}`)
      .bind(...extraParams, ...chunk)
      .all<Record<string, unknown>>();
    for (const r of results) {
      const m = mapRow(r);
      if (m.value !== null && m.value !== undefined) out.set(m.key, m.value);
    }
  }
  return out;
}

/**
 * Ranks candidate relievers for a given date/period.
 * Filtering:
 *  - active teachers only, excluding the absent teacher
 *  - conflict-free (no class, no existing assignment, no approved absence, not unavailable)
 * Ranking:
 *  - lower weekly workload first (least loaded)
 *  - then lower all-time relief load
 *  - availability records marked 'available' get a small bonus
 *
 * Optimized: bulk-loads all per-teacher data (conflicts, loads, availability)
 * with a small fixed number of batched queries instead of N×7 sequential ones.
 */
export async function findCandidates(
  AppEnv: AppEnv,
  excludeTeacherId: number,
  date: string,
  period: number,
  limit = 5
): Promise<Candidate[]> {
  const weekStart = startOfWeek(date);
  const weekEnd = endOfWeek(date);
  const wd = weekdayOf(date);

  const { results: teachers } = await AppEnv.DB.prepare(
    `SELECT u.id, u.name, u.email, tp.department, tp.subjects, tp.cluster, tp.room
     FROM users u
     LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
     WHERE u.role = 'teacher' AND u.active = 1 AND u.id != ?`
  )
    .bind(excludeTeacherId)
    .all<{ id: number; name: string; email: string; department: string; subjects: string; cluster: string; room: string }>();

  const teacherIds = teachers.map((t) => t.id);
  if (teacherIds.length === 0) return [];

  // Bulk conflict data: which teachers are busy at this weekday/date/period?
  const [schedBusy, reliefBusy, absenceBusy, availMap, weekLoads, totalLoads] = await Promise.all([
    queryChunked(
      AppEnv.DB,
      `SELECT teacher_id AS key, 1 AS value FROM schedules WHERE weekday = ? AND period = ? AND teacher_id`,
      "",
      teacherIds,
      [wd, period],
      (r) => ({ key: Number(r.key), value: 1 as number })
    ),
    queryChunked(
      AppEnv.DB,
      `SELECT reliever_id AS key, 1 AS value FROM relief_assignments
       WHERE date = ? AND period = ? AND status IN ${ACTIVE_STATUS} AND reliever_id`,
      "",
      teacherIds,
      [date, period],
      (r) => ({ key: Number(r.key), value: 1 as number })
    ),
    queryChunked(
      AppEnv.DB,
      `SELECT teacher_id AS key, 1 AS value FROM absences
       WHERE date = ? AND period = ? AND status = 'approved' AND teacher_id`,
      "",
      teacherIds,
      [date, period],
      (r) => ({ key: Number(r.key), value: 1 as number })
    ),
    queryChunked(
      AppEnv.DB,
      `SELECT teacher_id AS key, status AS value FROM availability
       WHERE date = ? AND period = ? AND teacher_id`,
      "",
      teacherIds,
      [date, period],
      (r) => ({ key: Number(r.key), value: r.value as string })
    ),
    queryChunked(
      AppEnv.DB,
      `SELECT reliever_id AS key, COUNT(*) AS value FROM relief_assignments
       WHERE date BETWEEN ? AND ? AND status IN ${ACTIVE_STATUS} AND reliever_id`,
      " GROUP BY reliever_id",
      teacherIds,
      [weekStart, weekEnd],
      (r) => ({ key: Number(r.key), value: Number(r.value) })
    ),
    queryChunked(
      AppEnv.DB,
      `SELECT reliever_id AS key, COUNT(*) AS value FROM relief_assignments
       WHERE status IN ${ACTIVE_STATUS} AND reliever_id`,
      " GROUP BY reliever_id",
      teacherIds,
      [],
      (r) => ({ key: Number(r.key), value: Number(r.value) })
    ),
  ]);

  const candidates: Candidate[] = [];
  for (const t of teachers) {
    // Skip teachers busy in any conflict dimension
    if (schedBusy.has(t.id) || reliefBusy.has(t.id) || absenceBusy.has(t.id)) continue;
    const avail = availMap.get(t.id);
    if (avail === "unavailable") continue;

    const weekly = weekLoads.get(t.id) ?? 0;
    const total = totalLoads.get(t.id) ?? 0;
    const bonus = avail === "available" ? -0.5 : 0;
    const score = weekly * 10 + total * 2 + bonus;

    candidates.push({
      teacher_id: t.id,
      name: t.name,
      email: t.email,
      department: t.department ?? "",
      subjects: t.subjects ?? "",
      cluster: t.cluster ?? "",
      room: t.room ?? "",
      workload_this_week: weekly,
      total_relief_periods: total,
      score,
      schedule_before: null,
      schedule_after: null,
    });
  }

  candidates.sort((a, b) => a.score - b.score);
  const top = candidates.slice(0, limit);

  if (top.length > 0) {
    const ids = top.map((c) => c.teacher_id);
    const adjRows: { teacher_id: number; period: number; subject: string; class_name: string }[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const placeholders = chunk.map(() => "?").join(",");
      const { results } = await AppEnv.DB.prepare(
        `SELECT teacher_id, period, subject, class_name
         FROM schedules
         WHERE weekday = ?
           AND period IN (?, ?)
           AND teacher_id IN (${placeholders})`
      )
        .bind(wd, period - 1, period + 1, ...chunk)
        .all<{ teacher_id: number; period: number; subject: string; class_name: string }>();
      adjRows.push(...results);
    }
    const byTeacher = new Map<number, { before: AdjacentClass | null; after: AdjacentClass | null }>();
    for (const r of adjRows) {
      const entry = byTeacher.get(r.teacher_id) ?? { before: null, after: null };
      const cls: AdjacentClass = { period: r.period, subject: r.subject, class_name: r.class_name };
      if (r.period === period - 1) entry.before = cls;
      if (r.period === period + 1) entry.after = cls;
      byTeacher.set(r.teacher_id, entry);
    }
    for (const c of top) {
      const e = byTeacher.get(c.teacher_id);
      c.schedule_before = e?.before ?? null;
      c.schedule_after = e?.after ?? null;
    }
  }

  return top;
}
