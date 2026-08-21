import { Hono } from "hono";
import type { AppContext } from "../types";
import { requireAuth } from "../lib/auth";
import { isValidDate, startOfWeek, endOfWeek, addDays, weekdayOf } from "../lib/dates";
import { getWorkload } from "../services/workload";

export const reportsRoutes = new Hono<AppContext>();

reportsRoutes.use("*", requireAuth);

/**
 * Overall summary used by the dashboard.
 */
export async function getSummary(db: D1Database) {
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = startOfWeek(today);
  const weekEnd = endOfWeek(today);

  const [teachers, absencesPending, absencesWeek, assignmentsWeek, assignmentsTotal, coverageToday] =
    await Promise.all([
      db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'teacher' AND active = 1")
        .first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM absences WHERE status = 'pending'")
        .first<{ n: number }>(),
      db.prepare(
        `SELECT COUNT(*) AS n FROM absences WHERE date BETWEEN ? AND ? AND status = 'approved'`
      )
        .bind(weekStart, weekEnd)
        .first<{ n: number }>(),
      db.prepare(
        `SELECT COUNT(*) AS n FROM relief_assignments
         WHERE date BETWEEN ? AND ? AND status IN ('assigned','accepted','overridden')`
      )
        .bind(weekStart, weekEnd)
        .first<{ n: number }>(),
      db.prepare(
        `SELECT COUNT(*) AS n FROM relief_assignments
         WHERE status IN ('assigned','accepted','overridden')`
      )
        .first<{ n: number }>(),
      db.prepare(
        `SELECT COUNT(*) AS n FROM absences WHERE date = ? AND status = 'approved'`
      )
        .bind(today)
        .first<{ n: number }>(),
    ]);

  return {
    today,
    week_start: weekStart,
    week_end: weekEnd,
    teachers: teachers?.n ?? 0,
    pending_absences: absencesPending?.n ?? 0,
    absences_this_week: absencesWeek?.n ?? 0,
    assignments_this_week: assignmentsWeek?.n ?? 0,
    assignments_total: assignmentsTotal?.n ?? 0,
    absences_today: coverageToday?.n ?? 0,
  };
}

reportsRoutes.get("/summary", async (c) => {
  return c.json(await getSummary(c.env.DB));
});

/**
 * Workload analysis for a given week.
 */
reportsRoutes.get("/workload", async (c) => {
  const date = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
  const rows = await getWorkload(c.env, date);
  return c.json({ week_start: startOfWeek(date), week_end: endOfWeek(date), workload: rows });
});

/**
 * Coverage report: for a date range, absence count vs. assigned count per day.
 */
reportsRoutes.get("/coverage", async (c) => {
  const from = c.req.query("from") ?? startOfWeek(new Date().toISOString().slice(0, 10));
  const to = c.req.query("to") ?? endOfWeek(new Date().toISOString().slice(0, 10));
  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    return c.json({ error: "Invalid date range" }, 400);
  }

  const { results: absences } = await c.env.DB.prepare(
    `SELECT date, COUNT(*) AS n FROM absences
     WHERE date BETWEEN ? AND ? AND status = 'approved'
     GROUP BY date ORDER BY date`
  )
    .bind(from, to)
    .all<{ date: string; n: number }>();
  const { results: assignments } = await c.env.DB.prepare(
    `SELECT date, COUNT(*) AS n FROM relief_assignments
     WHERE date BETWEEN ? AND ? AND status IN ('assigned','accepted','overridden')
     GROUP BY date ORDER BY date`
  )
    .bind(from, to)
    .all<{ date: string; n: number }>();

  const byDate = new Map<string, { absences: number; assigned: number; uncovered: number }>();
  let d = from;
  while (d <= to) {
    byDate.set(d, { absences: 0, assigned: 0, uncovered: 0 });
    const next = new Date(`${d}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  for (const a of absences) {
    const entry = byDate.get(a.date) ?? { absences: 0, assigned: 0, uncovered: 0 };
    entry.absences = a.n;
    byDate.set(a.date, entry);
  }
  for (const a of assignments) {
    const entry = byDate.get(a.date) ?? { absences: 0, assigned: 0, uncovered: 0 };
    entry.assigned = a.n;
    byDate.set(a.date, entry);
  }
  for (const entry of byDate.values()) {
    entry.uncovered = Math.max(0, entry.absences - entry.assigned);
  }

  const days = Array.from(byDate.entries()).map(([date, v]) => ({
    date,
    weekday: weekdayOf(date),
    ...v,
  }));
  const totalAbsences = days.reduce((s, d) => s + d.absences, 0);
  const totalAssigned = days.reduce((s, d) => s + d.assigned, 0);
  const coverageRate =
    totalAbsences > 0 ? Math.round((totalAssigned / totalAbsences) * 100) : 100;

  return c.json({ from, to, days, total_absences: totalAbsences, total_assigned: totalAssigned, coverage_rate: coverageRate });
});

/**
 * Relief assignment history (optionally per teacher).
 */
reportsRoutes.get("/history", async (c) => {
  const teacherId = c.req.query("teacher_id");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const status = c.req.query("status");

  let sql = `SELECT r.id, r.absence_id, r.reliever_id, ru.name AS reliever_name,
                    r.date, r.period, r.subject, r.class_name, r.status, r.is_override,
                    r.created_at, r.updated_at,
                    au.name AS absent_teacher_name
             FROM relief_assignments r
             JOIN users ru ON ru.id = r.reliever_id
             JOIN absences a ON a.id = r.absence_id
             JOIN users au ON au.id = a.teacher_id`;
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (teacherId) {
    clauses.push("r.reliever_id = ?");
    params.push(Number(teacherId));
  }
  if (from && isValidDate(from)) {
    clauses.push("r.date >= ?");
    params.push(from);
  }
  if (to && isValidDate(to)) {
    clauses.push("r.date <= ?");
    params.push(to);
  }
  if (status) {
    clauses.push("r.status = ?");
    params.push(status);
  }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY r.date DESC, r.period ASC, r.created_at DESC";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ history: results });
});

/**
 * Absence reasons breakdown.
 */
reportsRoutes.get("/absences-by-reason", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  let sql = `SELECT CASE WHEN reason = '' THEN '(no reason)' ELSE reason END AS reason,
                    COUNT(*) AS n FROM absences WHERE status = 'approved'`;
  const params: string[] = [];
  if (from && isValidDate(from)) {
    sql += " AND date >= ?";
    params.push(from);
  }
  if (to && isValidDate(to)) {
    sql += " AND date <= ?";
    params.push(to);
  }
  sql += " GROUP BY reason ORDER BY n DESC";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ reasons: results });
});

/**
 * CSV export of history (admin convenience).
 */
reportsRoutes.get("/export.csv", async (c) => {
  const teacherId = c.req.query("teacher_id");
  const from = c.req.query("from");
  const to = c.req.query("to");

  let sql = `SELECT ru.name AS reliever_name, au.name AS absent_teacher_name,
                    r.date, r.period, r.subject, r.class_name, r.status, r.is_override, r.created_at
             FROM relief_assignments r
             JOIN users ru ON ru.id = r.reliever_id
             JOIN absences a ON a.id = r.absence_id
             JOIN users au ON au.id = a.teacher_id`;
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (teacherId) {
    clauses.push("r.reliever_id = ?");
    params.push(Number(teacherId));
  }
  if (from && isValidDate(from)) {
    clauses.push("r.date >= ?");
    params.push(from);
  }
  if (to && isValidDate(to)) {
    clauses.push("r.date <= ?");
    params.push(to);
  }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY r.date DESC, r.period ASC";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();
  const header = ["reliever", "absent_teacher", "date", "period", "subject", "class", "status", "override", "created_at"];
  const rows = results.map((r) =>
    header.map((h) => {
      const v = r[h] ?? "";
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    }).join(",")
  );
  const csv = [header.join(","), ...rows].join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trace-relief-history-${from ?? "all"}-${to ?? "all"}.csv"`,
    },
  });
});