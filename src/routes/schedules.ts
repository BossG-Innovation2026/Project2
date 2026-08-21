import { Hono } from "hono";
import type { AppContext } from "../types";
import { requireAuth, requireAdmin, getPeriodCount } from "../lib/auth";

export const schedulesRoutes = new Hono<AppContext>();

schedulesRoutes.use("*", requireAuth, requireAdmin);

schedulesRoutes.get("/", async (c) => {
  const teacherId = c.req.query("teacher_id");
  const weekday = c.req.query("weekday");
  const limit = getPeriodCount(c.env.DB);

  let sql = `SELECT s.id, s.teacher_id, u.name AS teacher_name, s.weekday, s.period, s.subject, s.class_name
             FROM schedules s JOIN users u ON u.id = s.teacher_id`;
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (teacherId) {
    clauses.push("s.teacher_id = ?");
    params.push(Number(teacherId));
  }
  if (weekday !== undefined) {
    clauses.push("s.weekday = ?");
    params.push(Number(weekday));
  }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY s.teacher_id, s.weekday, s.period";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all<{
    id: number;
    teacher_id: number;
    teacher_name: string;
    weekday: number;
    period: number;
    subject: string;
    class_name: string;
  }>();
  const count = await limit;
  return c.json({ schedules: results, period_count: count });
});

schedulesRoutes.post("/", requireAdmin, async (c) => {
  const body = await c.req.json<{
    teacher_id: number;
    weekday: number;
    period: number;
    subject?: string;
    class_name?: string;
  }>();
  if (!body.teacher_id || body.weekday < 0 || body.weekday > 6 || body.period < 1) {
    return c.json({ error: "Invalid schedule entry" }, 400);
  }
  if (body.weekday > 4) {
    return c.json({ error: "Weekday must be Monday to Friday" }, 400);
  }
  const pc = await getPeriodCount(c.env.DB);
  if (body.period > pc) return c.json({ error: `Period must be between 1 and ${pc}` }, 400);

  const existing = await c.env.DB.prepare(
    "SELECT id FROM schedules WHERE teacher_id = ? AND weekday = ? AND period = ?"
  )
    .bind(body.teacher_id, body.weekday, body.period)
    .first();
  if (existing) {
    return c.json({ error: "Teacher is already assigned at this time slot" }, 409);
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO schedules (teacher_id, weekday, period, subject, class_name)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(body.teacher_id, body.weekday, body.period, body.subject ?? "", body.class_name ?? "")
    .run();
  return c.json({ id: Number(result.meta.last_row_id) }, 201);
});

schedulesRoutes.put("/:id", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{
    teacher_id?: number;
    subject?: string;
    class_name?: string;
  }>();
  const row = await c.env.DB.prepare(
    "SELECT id, teacher_id, weekday, period, subject, class_name FROM schedules WHERE id = ?"
  )
    .bind(id)
    .first<{
      id: number;
      teacher_id: number;
      weekday: number;
      period: number;
      subject: string;
      class_name: string;
    }>();
  if (!row) return c.json({ error: "Schedule entry not found" }, 404);
  const teacherId = body.teacher_id ?? row.teacher_id;
  if (!teacherId) return c.json({ error: "Invalid schedule entry" }, 400);
  const clash = await c.env.DB.prepare(
    "SELECT id FROM schedules WHERE teacher_id = ? AND weekday = ? AND period = ? AND id != ?"
  )
    .bind(teacherId, row.weekday, row.period, id)
    .first();
  if (clash) {
    return c.json({ error: "Teacher is already assigned at this time slot" }, 409);
  }
  await c.env.DB.prepare("UPDATE schedules SET teacher_id = ?, subject = ?, class_name = ? WHERE id = ?")
    .bind(teacherId, body.subject ?? row.subject, body.class_name ?? row.class_name, id)
    .run();
  return c.json({ ok: true });
});

schedulesRoutes.delete("/:id", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const result = await c.env.DB.prepare("DELETE FROM schedules WHERE id = ?").bind(id).run();
  if (!result.success || result.meta.changes === 0) {
    return c.json({ error: "Schedule entry not found" }, 404);
  }
  return c.json({ ok: true });
});

/**
 * Replace the ENTIRE schedule table with a generated timetable (admin only).
 * Body: { entries: [{ teacher_id, weekday, period, subject?, class_name? }] }
 * Validated fully, then applied atomically in one D1 batch.
 */
schedulesRoutes.post("/replace-all", requireAdmin, async (c) => {
  const body = await c.req.json<{
    entries?: {
      teacher_id: number;
      weekday: number;
      period: number;
      subject?: string;
      class_name?: string;
    }[];
  }>();
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (entries.length === 0) return c.json({ error: "No entries provided" }, 400);
  if (entries.length > 2000) return c.json({ error: "Too many entries (max 2000)" }, 400);

  const pc = await getPeriodCount(c.env.DB);
  const teacherBusy = new Set<string>();
  const classBusy = new Set<string>();
  for (const e of entries) {
    if (
      !Number.isInteger(e.teacher_id) || e.teacher_id < 1 ||
      !Number.isInteger(e.weekday) || e.weekday < 0 || e.weekday > 4 ||
      !Number.isInteger(e.period) || e.period < 1 || e.period > pc
    ) {
      return c.json({ error: `Invalid entry: teacher ${e.teacher_id}, day ${e.weekday}, period ${e.period}` }, 400);
    }
    if (!e.class_name || typeof e.class_name !== "string") {
      return c.json({ error: "Every entry requires a class name" }, 400);
    }
    const tKey = `${e.teacher_id}|${e.weekday}|${e.period}`;
    if (teacherBusy.has(tKey)) {
      return c.json({ error: `Teacher ${e.teacher_id} is double-booked on day ${e.weekday}, period ${e.period}` }, 400);
    }
    teacherBusy.add(tKey);
    const cKey = `${e.class_name}|${e.weekday}|${e.period}`;
    if (classBusy.has(cKey)) {
      return c.json({ error: `Class ${e.class_name} is double-booked on day ${e.weekday}, period ${e.period}` }, 400);
    }
    classBusy.add(cKey);
  }

  const teacherIds = [...new Set(entries.map((e) => e.teacher_id))];
  const ph = teacherIds.map(() => "?").join(",");
  const { results: validTeachers } = await c.env.DB.prepare(
    `SELECT u.id, COALESCE(tp.max_weekly_load, 0) AS max_weekly_load
     FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
     WHERE u.id IN (${ph}) AND u.role = 'teacher' AND u.active = 1`
  )
    .bind(...teacherIds)
    .all<{ id: number; max_weekly_load: number }>();
  const loadCaps = new Map(validTeachers.map((t) => [t.id, t.max_weekly_load]));
  for (const id of teacherIds) {
    if (!loadCaps.has(id)) return c.json({ error: `Teacher ${id} does not exist or is inactive` }, 400);
  }
  const loadCount = new Map<number, number>();
  for (const e of entries) loadCount.set(e.teacher_id, (loadCount.get(e.teacher_id) ?? 0) + 1);
  for (const [id, count] of loadCount) {
    const cap = loadCaps.get(id) ?? 0;
    if (cap > 0 && count > cap) {
      return c.json({ error: `Teacher ${id} exceeds their weekly load cap (${count} > ${cap})` }, 400);
    }
  }

  const stmts: D1PreparedStatement[] = [c.env.DB.prepare("DELETE FROM schedules")];
  for (const e of entries) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO schedules (teacher_id, weekday, period, subject, class_name) VALUES (?, ?, ?, ?, ?)"
      ).bind(e.teacher_id, e.weekday, e.period, e.subject ?? "", e.class_name)
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, replaced: entries.length });
});