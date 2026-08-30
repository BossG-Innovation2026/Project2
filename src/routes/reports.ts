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
  const user = c.get("user");
  // Non-admins may only view their own relief history
  const teacherId = user.role !== "admin" ? String(user.id) : c.req.query("teacher_id");
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
 * Absence reasons breakdown (optionally per teacher).
 */
reportsRoutes.get("/absences-by-reason", async (c) => {
  const user = c.get("user");
  const teacherId = c.req.query("teacher_id") ?? (user.role !== "admin" ? String(user.id) : null);
  const from = c.req.query("from");
  const to = c.req.query("to");
  let sql = `SELECT CASE WHEN reason = '' THEN '(no reason)' ELSE reason END AS reason,
                    COUNT(*) AS n FROM absences WHERE status = 'approved'`;
  const params: Array<string | number> = [];
  if (teacherId) {
    sql += " AND teacher_id = ?";
    params.push(Number(teacherId));
  }
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
 * Teacher-specific summary: leaves, relief, workload.
 */
reportsRoutes.get("/my-summary", async (c) => {
  const user = c.get("user");
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = startOfWeek(today);
  const weekEnd = endOfWeek(today);

  const [leavesWeek, leavesAll, leavesPending, reliefWeek, reliefAll, profile] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM absences WHERE teacher_id = ? AND date BETWEEN ? AND ? AND status = 'approved'`
    ).bind(user.id, weekStart, weekEnd).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM absences WHERE teacher_id = ? AND status = 'approved'`
    ).bind(user.id).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM absences WHERE teacher_id = ? AND status = 'pending'`
    ).bind(user.id).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM relief_assignments WHERE reliever_id = ? AND date BETWEEN ? AND ? AND status = 'accepted'`
    ).bind(user.id, weekStart, weekEnd).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM relief_assignments WHERE reliever_id = ? AND status = 'accepted'`
    ).bind(user.id).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT tp.max_weekly_load FROM teacher_profiles tp WHERE tp.user_id = ?`
    ).bind(user.id).first<{ max_weekly_load: number }>(),
  ]);

  const sched = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM schedules WHERE teacher_id = ?`
  ).bind(user.id).first<{ n: number }>();

  const scheduled = sched?.n ?? 0;
  const reliefNow = reliefWeek?.n ?? 0;
  const maxLoad = profile?.max_weekly_load ?? 0;
  const totalLoad = scheduled + reliefNow;
  const utilization = maxLoad > 0 ? Math.round((totalLoad / maxLoad) * 100) : 0;

  return c.json({
    leaves_this_week: leavesWeek?.n ?? 0,
    leaves_all_time: leavesAll?.n ?? 0,
    leaves_pending: leavesPending?.n ?? 0,
    relief_this_week: reliefWeek?.n ?? 0,
    relief_all_time: reliefAll?.n ?? 0,
    scheduled_periods: scheduled,
    max_weekly_load: maxLoad,
    total_load: totalLoad,
    utilization,
  });
});

/**
 * Teacher's monthly leaves (last 6 months).
 */
reportsRoutes.get("/my-monthly-leaves", async (c) => {
  const user = c.get("user");
  const months: { month: string; label: string; n: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthStart = d.toISOString().slice(0, 7) + "-01";
    const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const monthEnd = nextMonth.toISOString().slice(0, 7) + "-01";
    const label = d.toLocaleString("en-US", { month: "short" });
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM absences WHERE teacher_id = ? AND date >= ? AND date < ? AND status = 'approved'`
    ).bind(user.id, monthStart, monthEnd).first<{ n: number }>();
    months.push({ month: monthStart.slice(0, 7), label, n: row?.n ?? 0 });
  }
  return c.json({ months });
});

/**
 * Teacher's relief assignments grouped by subject.
 */
reportsRoutes.get("/my-relief-by-subject", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT CASE WHEN subject = '' THEN '(unspecified)' ELSE subject END AS subject,
            COUNT(*) AS n FROM relief_assignments
     WHERE reliever_id = ? AND status = 'accepted'
     GROUP BY subject ORDER BY n DESC`
  ).bind(user.id).all<{ subject: string; n: number }>();
  return c.json({ subjects: results });
});

/**
 * Teacher's own workload breakdown.
 */
reportsRoutes.get("/my-workload", async (c) => {
  const user = c.get("user");
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = startOfWeek(today);
  const weekEnd = endOfWeek(today);

  const [profile, sched, reliefWeek, reliefAll] = await Promise.all([
    c.env.DB.prepare(
      `SELECT tp.department, tp.subjects, tp.max_weekly_load FROM teacher_profiles tp WHERE tp.user_id = ?`
    ).bind(user.id).first<{ department: string; subjects: string; max_weekly_load: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM schedules WHERE teacher_id = ?`
    ).bind(user.id).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM relief_assignments WHERE reliever_id = ? AND date BETWEEN ? AND ? AND status = 'accepted'`
    ).bind(user.id, weekStart, weekEnd).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM relief_assignments WHERE reliever_id = ? AND status = 'accepted'`
    ).bind(user.id).first<{ n: number }>(),
  ]);

  const scheduled = sched?.n ?? 0;
  const reliefNow = reliefWeek?.n ?? 0;
  const maxLoad = profile?.max_weekly_load ?? 0;
  const available = Math.max(0, maxLoad - scheduled - reliefNow);

  return c.json({
    department: profile?.department ?? "",
    subjects: profile?.subjects ?? "",
    max_weekly_load: maxLoad,
    scheduled_periods: scheduled,
    relief_this_week: reliefNow,
    relief_all_time: reliefAll?.n ?? 0,
    available,
  });
});

/**
 * CSV export of history (admin convenience).
 */
reportsRoutes.get("/export.csv", async (c) => {
  const user = c.get("user");
  // Non-admins may only export their own relief history
  const teacherId = user.role !== "admin" ? String(user.id) : c.req.query("teacher_id");
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