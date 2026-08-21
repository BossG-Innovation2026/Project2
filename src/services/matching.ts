import type { AppEnv } from "../types";
import { detectConflicts } from "./conflicts";
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

/**
 * Ranks candidate relievers for a given date/period.
 * Filtering:
 *  - active teachers only, excluding the absent teacher
 *  - conflict-free (no class, no existing assignment, no approved absence, not unavailable)
 * Ranking:
 *  - lower weekly workload first (least loaded)
 *  - then lower all-time relief load
 *  - availability records marked 'available' get a small bonus
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

  const { results: teachers } = await AppEnv.DB.prepare(
    `SELECT u.id, u.name, u.email, tp.department, tp.subjects, tp.cluster, tp.room
     FROM users u
     LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
     WHERE u.role = 'teacher' AND u.active = 1 AND u.id != ?`
  )
    .bind(excludeTeacherId)
    .all<{ id: number; name: string; email: string; department: string; subjects: string; cluster: string; room: string }>();

  const candidates: Candidate[] = [];
  for (const t of teachers) {
    const conflicts = await detectConflicts(AppEnv, t.id, date, period);
    if (conflicts.length > 0) continue;

    const weekLoad = await AppEnv.DB.prepare(
      `SELECT COUNT(*) AS n FROM relief_assignments
       WHERE reliever_id = ? AND date BETWEEN ? AND ?
         AND status IN ('assigned', 'accepted', 'overridden')`
    )
      .bind(t.id, weekStart, weekEnd)
      .first<{ n: number }>();

    const totalLoad = await AppEnv.DB.prepare(
      `SELECT COUNT(*) AS n FROM relief_assignments
       WHERE reliever_id = ? AND status IN ('assigned', 'accepted', 'overridden')`
    )
      .bind(t.id)
      .first<{ n: number }>();

    const availMark = await AppEnv.DB.prepare(
      "SELECT status FROM availability WHERE teacher_id = ? AND date = ? AND period = ?"
    )
      .bind(t.id, date, period)
      .first<{ status: string }>();

    const weekly = weekLoad?.n ?? 0;
    const total = totalLoad?.n ?? 0;
    const bonus = availMark?.status === "available" ? -0.5 : 0;
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
    const placeholders = ids.map(() => "?").join(",");
    const { results: adjRows } = await AppEnv.DB.prepare(
      `SELECT teacher_id, period, subject, class_name
       FROM schedules
       WHERE weekday = ?
         AND period IN (?, ?)
         AND teacher_id IN (${placeholders})`
    )
      .bind(weekdayOf(date), period - 1, period + 1, ...ids)
      .all<{ teacher_id: number; period: number; subject: string; class_name: string }>();
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