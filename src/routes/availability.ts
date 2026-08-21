import { Hono } from "hono";
import type { AppContext } from "../types";
import { requireAuth, getPeriodCount, getPeriodNames } from "../lib/auth";
import { isValidDate, weekdayOf } from "../lib/dates";

export const availabilityRoutes = new Hono<AppContext>();

availabilityRoutes.use("*", requireAuth);

async function slotConflict(
  db: D1Database,
  teacherId: number,
  date: string,
  period: number
): Promise<string | null> {
  const wd = weekdayOf(date);
  const sched = await db
    .prepare("SELECT id FROM schedules WHERE teacher_id = ? AND weekday = ? AND period = ?")
    .bind(teacherId, wd, period)
    .first();
  if (sched) return "This period has a scheduled class and is locked";
  const relief = await db
    .prepare(
      `SELECT id FROM relief_assignments WHERE reliever_id = ? AND date = ? AND period = ?
       AND status IN ('assigned','accepted','overridden')`
    )
    .bind(teacherId, date, period)
    .first();
  if (relief) return "This period has an active relief assignment and is locked";
  return null;
}

availabilityRoutes.get("/", async (c) => {
  const date = c.req.query("date") ?? "";
  const teacherId = c.req.query("teacher_id");
  const from = c.req.query("from");
  const to = c.req.query("to");

  if (date && !isValidDate(date)) return c.json({ error: "Invalid date" }, 400);

  let sql = "SELECT * FROM availability";
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (date) {
    clauses.push("date = ?");
    params.push(date);
  }
  if (teacherId) {
    clauses.push("teacher_id = ?");
    params.push(Number(teacherId));
  }
  if (from && isValidDate(from)) {
    clauses.push("date >= ?");
    params.push(from);
  }
  if (to && isValidDate(to)) {
    clauses.push("date <= ?");
    params.push(to);
  }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY date, period, teacher_id";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();

  let schedules: { teacher_id: number; weekday: number; period: number }[] = [];
  let relief: { teacher_id: number; date: string; period: number }[] = [];
  if (teacherId) {
    const tid = Number(teacherId);
    const schedRes = await c.env.DB.prepare(
      "SELECT teacher_id, weekday, period FROM schedules WHERE teacher_id = ?"
    )
      .bind(tid)
      .all<{ teacher_id: number; weekday: number; period: number }>();
    schedules = schedRes.results;
    if (from && isValidDate(from) && to && isValidDate(to)) {
      const reliefRes = await c.env.DB.prepare(
        `SELECT reliever_id AS teacher_id, date, period FROM relief_assignments
         WHERE reliever_id = ? AND date >= ? AND date <= ?
           AND status IN ('assigned','accepted','overridden')`
      )
        .bind(tid, from, to)
        .all<{ teacher_id: number; date: string; period: number }>();
      relief = reliefRes.results;
    }
  }

  return c.json({ availability: results, schedules, relief });
});

/**
 * Set availability for a date/period.
 * Admin can set any teacher's availability; teachers can only set their own.
 * Body: { teacher_id?, date, period, status }
 */
availabilityRoutes.post("/", async (c) => {
  const body = await c.req.json<{
    teacher_id?: number;
    date: string;
    period: number;
    status: "available" | "unavailable" | "class";
  }>();
  if (!isValidDate(body.date) || body.period < 1) {
    return c.json({ error: "Invalid date or period" }, 400);
  }
  if (!["available", "unavailable", "class"].includes(body.status)) {
    return c.json({ error: "Invalid status" }, 400);
  }
  const pc = await getPeriodCount(c.env.DB);
  if (body.period > pc) return c.json({ error: `Period must be between 1 and ${pc}` }, 400);

  const teacherId = body.teacher_id ?? c.get("user").id;
  if (c.get("user").role !== "admin" && teacherId !== c.get("user").id) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const conflict = await slotConflict(c.env.DB, teacherId, body.date, body.period);
  if (conflict) return c.json({ error: conflict }, 409);
  const existing = await c.env.DB.prepare(
    "SELECT id FROM availability WHERE teacher_id = ? AND date = ? AND period = ?"
  )
    .bind(teacherId, body.date, body.period)
    .first();
  if (existing) {
    await c.env.DB.prepare(
      "UPDATE availability SET status = ?, source = 'manual' WHERE id = ?"
    )
      .bind(body.status, existing.id)
      .run();
  } else {
    await c.env.DB.prepare(
      "INSERT INTO availability (teacher_id, date, period, status, source) VALUES (?, ?, ?, ?, 'manual')"
    )
      .bind(teacherId, body.date, body.period, body.status)
      .run();
  }
  return c.json({ ok: true });
});

/**
 * Bulk set availability for a date range. Body: { teacher_id?, from, to, periods: { period: status } }
 */
availabilityRoutes.post("/bulk", async (c) => {
  const body = await c.req.json<{
    teacher_id?: number;
    from: string;
    to: string;
    periods: Record<string, "available" | "unavailable" | "class">;
  }>();
  if (!isValidDate(body.from) || !isValidDate(body.to) || body.from > body.to) {
    return c.json({ error: "Invalid date range" }, 400);
  }
  const teacherId = body.teacher_id ?? c.get("user").id;
  if (c.get("user").role !== "admin" && teacherId !== c.get("user").id) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const pc = await getPeriodCount(c.env.DB);
  for (const [periodStr, status] of Object.entries(body.periods)) {
    const period = Number(periodStr);
    if (period < 1 || period > pc) continue;
    if (!["available", "unavailable", "class"].includes(status)) continue;
    // iterate dates
    let d = body.from;
    while (d <= body.to) {
      const conflict = await slotConflict(c.env.DB, teacherId, d, period);
      if (!conflict) {
        const existing = await c.env.DB.prepare(
          "SELECT id FROM availability WHERE teacher_id = ? AND date = ? AND period = ?"
        )
          .bind(teacherId, d, period)
          .first();
        if (existing) {
          await c.env.DB.prepare("UPDATE availability SET status = ?, source = 'manual' WHERE id = ?")
            .bind(status, existing.id)
            .run();
        } else {
          await c.env.DB.prepare(
            "INSERT INTO availability (teacher_id, date, period, status, source) VALUES (?, ?, ?, ?, 'manual')"
          )
            .bind(teacherId, d, period, status)
            .run();
        }
      }
      const next = new Date(`${d}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      d = next.toISOString().slice(0, 10);
    }
  }
  return c.json({ ok: true });
});

/**
 * Coverage matrix for the calendar: for each date/period, list every teacher's
 * derived status (class/available/unavailable) + the absence info.
 */
availabilityRoutes.get("/coverage", async (c) => {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!isValidDate(from) || !isValidDate(to)) return c.json({ error: "Invalid range" }, 400);
  const pc = await getPeriodCount(c.env.DB);
  const names = await getPeriodNames(c.env.DB);

  const [schedules, absences, assignments, availability] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.teacher_id, s.weekday, s.period, s.subject, s.class_name, u.name AS teacher_name
       FROM schedules s JOIN users u ON u.id = s.teacher_id`
    ).all<{ teacher_id: number; weekday: number; period: number; subject: string; class_name: string; teacher_name: string }>(),
    c.env.DB.prepare(
      `SELECT a.id, a.teacher_id, a.date, a.period, a.reason, a.status, u.name AS teacher_name
       FROM absences a JOIN users u ON u.id = a.teacher_id
       WHERE a.date BETWEEN ? AND ?`
    )
      .bind(from, to)
      .all<{ id: number; teacher_id: number; date: string; period: number; reason: string; status: string; teacher_name: string }>(),
    c.env.DB.prepare(
      `SELECT r.id, r.absence_id, r.reliever_id, r.date, r.period, r.subject, r.class_name, r.status, r.is_override,
              u.name AS reliever_name, a.teacher_id AS absent_teacher_id
       FROM relief_assignments r
       JOIN users u ON u.id = r.reliever_id
       JOIN absences a ON a.id = r.absence_id
       WHERE r.date BETWEEN ? AND ?`
    )
      .bind(from, to)
      .all<{ id: number; absence_id: number; reliever_id: number; date: string; period: number; subject: string; class_name: string; status: string; is_override: number; reliever_name: string; absent_teacher_id: number }>(),
    c.env.DB.prepare(
      `SELECT av.teacher_id, av.date, av.period, av.status, u.name AS teacher_name
       FROM availability av JOIN users u ON u.id = av.teacher_id
       WHERE av.date BETWEEN ? AND ?`
    )
      .bind(from, to)
      .all<{ teacher_id: number; date: string; period: number; status: string; teacher_name: string }>(),
  ]);

  const { results: teachers } = await c.env.DB.prepare(
    `SELECT u.id, u.name, tp.department FROM users u
     LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
     WHERE u.role = 'teacher' AND u.active = 1 ORDER BY u.name`
  ).all<{ id: number; name: string; department: string }>();

  // days in range
  const days: { date: string; weekday: number }[] = [];
  let d = from;
  while (d <= to) {
    days.push({ date: d, weekday: weekdayOf(d) });
    const next = new Date(`${d}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }

  const schedByTeacher = new Map<number, Map<number, { subject: string; class_name: string }>>();
  for (const s of schedules.results) {
    if (!schedByTeacher.has(s.teacher_id)) schedByTeacher.set(s.teacher_id, new Map());
    schedByTeacher.get(s.teacher_id)!.set(s.period, { subject: s.subject, class_name: s.class_name });
  }
  const absByKey = new Map<string, (typeof absences.results)[number]>();
  for (const a of absences.results) absByKey.set(`${a.date}|${a.teacher_id}|${a.period}`, a);
  const assignByKey = new Map<string, (typeof assignments.results)[number]>();
  for (const r of assignments.results) assignByKey.set(`${r.date}|${r.reliever_id}|${r.period}`, r);
  const availByKey = new Map<string, (typeof availability.results)[number]>();
  for (const a of availability.results) availByKey.set(`${a.date}|${a.teacher_id}|${a.period}`, a);

  const cells: Record<string, unknown>[] = [];
  for (const day of days) {
    for (let period = 1; period <= pc; period++) {
      for (const t of teachers) {
        const sched = schedByTeacher.get(t.id)?.get(period);
        const abs = absByKey.get(`${day.date}|${t.id}|${period}`);
        const assign = assignByKey.get(`${day.date}|${t.id}|${period}`);
        const avail = availByKey.get(`${day.date}|${t.id}|${period}`);
        const status = abs && abs.status !== "declined" ? "absent" : sched ? "class" : avail ? avail.status : "available";
        cells.push({
          date: day.date,
          weekday: day.weekday,
          period,
          teacher_id: t.id,
          teacher_name: t.name,
          department: t.department ?? "",
          status,
          subject: abs && abs.status !== "declined" ? (sched?.subject ?? "") : sched?.subject ?? "",
          class_name: sched?.class_name ?? "",
          absence_id: abs?.id ?? null,
          absence_status: abs?.status ?? null,
          absence_reason: abs?.reason ?? "",
          assignment_id: assign?.id ?? null,
          assignment_status: assign?.status ?? null,
          is_override: assign?.is_override ?? 0,
          reliever_name: assign?.reliever_name ?? null,
          absent_teacher_id: assign?.absent_teacher_id ?? null,
        });
      }
    }
  }

  return c.json({ period_count: pc, period_names: names, teachers, cells });
});