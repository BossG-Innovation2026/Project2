import { Hono } from "hono";
import type { AppContext } from "../types";
import { requireAuth, requireAdmin, createPasswordHash } from "../lib/auth";

export const teachersRoutes = new Hono<AppContext>();

interface TeacherPayload {
  name?: string;
  email?: string;
  password?: string;
  department?: string;
  subjects?: string;
  cluster?: string;
  room?: string;
  max_weekly_load?: number;
  notes?: string;
  active?: boolean;
}

teachersRoutes.use("*", requireAuth);

teachersRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
            tp.department, tp.subjects, tp.cluster, tp.room, tp.max_weekly_load, tp.notes
     FROM users u
     LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
     WHERE u.role = 'teacher'
     ORDER BY u.name`
  ).all();
  return c.json({ teachers: results });
});

teachersRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
            tp.department, tp.subjects, tp.cluster, tp.room, tp.max_weekly_load, tp.notes
     FROM users u
     LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
     WHERE u.id = ? AND u.role = 'teacher'`
  )
    .bind(id)
    .first();
  if (!row) return c.json({ error: "Teacher not found" }, 404);
  return c.json({ teacher: row });
});

teachersRoutes.post("/", requireAdmin, async (c) => {
  const body = await c.req.json<TeacherPayload>();
  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!name || !email || !password) {
    return c.json({ error: "Name, email and password are required" }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first();
  if (existing) return c.json({ error: "Email already in use" }, 409);

  const hash = await createPasswordHash(password);
  const result = await c.env.DB.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'teacher')"
  )
    .bind(name, email, hash)
    .run();
  const userId = Number(result.meta.last_row_id);
  await c.env.DB.prepare(
    `INSERT INTO teacher_profiles (user_id, department, subjects, cluster, room, max_weekly_load, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      userId,
      body.department ?? "",
      body.subjects ?? "",
      body.cluster ?? "",
      body.room ?? "",
      body.max_weekly_load ?? 0,
      body.notes ?? ""
    )
    .run();
  return c.json({ id: userId }, 201);
});

teachersRoutes.put("/:id", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<TeacherPayload>();
  const row = await c.env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND role = 'teacher'"
  )
    .bind(id)
    .first();
  if (!row) return c.json({ error: "Teacher not found" }, 404);

  const current = await c.env.DB.prepare(
    `SELECT u.name, u.email, u.active, tp.department, tp.subjects, tp.cluster, tp.room, tp.max_weekly_load, tp.notes
     FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id = u.id WHERE u.id = ?`
  )
    .bind(id)
    .first<{
      name: string;
      email: string;
      active: number;
      department: string;
      subjects: string;
      cluster: string;
      room: string;
      max_weekly_load: number;
      notes: string;
    }>();
  if (!current) return c.json({ error: "Teacher not found" }, 404);

  const name = body.name?.trim() || current.name;
  let email = body.email?.trim().toLowerCase() || current.email;
  if (email !== current.email) {
    const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ? AND id != ?")
      .bind(email, id)
      .first();
    if (existing) return c.json({ error: "Email already in use" }, 409);
  }

  await c.env.DB.prepare(
    "UPDATE users SET name = ?, email = ?, active = ? WHERE id = ?"
  )
    .bind(name, email, body.active === undefined ? current.active : body.active ? 1 : 0, id)
    .run();

  if (body.password) {
    if (body.password.length < 8) {
      return c.json({ error: "Password must be at least 8 characters" }, 400);
    }
    const hash = await createPasswordHash(body.password);
    await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(hash, id).run();
  }

  await c.env.DB.prepare(
    `UPDATE teacher_profiles SET department = ?, subjects = ?, cluster = ?, room = ?, max_weekly_load = ?, notes = ?
     WHERE user_id = ?`
  )
    .bind(
      body.department ?? current.department ?? "",
      body.subjects ?? current.subjects ?? "",
      body.cluster ?? current.cluster ?? "",
      body.room ?? current.room ?? "",
      body.max_weekly_load ?? current.max_weekly_load ?? 0,
      body.notes ?? current.notes ?? "",
      id
    )
    .run();
  return c.json({ ok: true });
});

teachersRoutes.delete("/:id", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const result = await c.env.DB.prepare("DELETE FROM users WHERE id = ? AND role = 'teacher'")
    .bind(id)
    .run();
  if (!result.success || result.meta.changes === 0) {
    return c.json({ error: "Teacher not found" }, 404);
  }
  return c.json({ ok: true });
});