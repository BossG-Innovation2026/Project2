import { Hono } from "hono";
import type { AppContext } from "../types";
import {
  createSession,
  createPasswordHash,
  setSessionCookie,
  clearSessionCookie,
  verifyPassword,
  requireAuth,
} from "../lib/auth";

export const authRoutes = new Hono<AppContext>();

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }
  const user = await c.env.DB.prepare(
    "SELECT id, password_hash FROM users WHERE email = ? AND active = 1"
  )
    .bind(email)
    .first<{ id: number; password_hash: string }>();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: "Invalid email or password" }, 401);
  }
  const token = await createSession(c, user.id);
  setSessionCookie(c, token);
  const info = await c.env.DB.prepare("SELECT id, name, email, role FROM users WHERE id = ?")
    .bind(user.id)
    .first();
  return c.json({ user: info });
});

authRoutes.post("/logout", requireAuth, async (c) => {
  await c.env.SESSIONS.delete(`session:${c.get("sessionToken")}`);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, async (c) => {
  return c.json({ user: c.get("user") });
});

authRoutes.post("/verify", requireAuth, async (c) => {
  const body = await c.req.json<{ password?: string }>();
  if (!body.password) {
    return c.json({ error: "Password is required" }, 400);
  }
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
    .bind(c.get("user").id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(body.password, row.password_hash))) {
    return c.json({ error: "Incorrect password" }, 401);
  }
  return c.json({ ok: true });
});

authRoutes.post("/change-password", requireAuth, async (c) => {
  const body = await c.req.json<{ current?: string; new_password?: string }>();
  if (!body.current || !body.new_password) {
    return c.json({ error: "Current and new password are required" }, 400);
  }
  if (body.new_password.length < 8) {
    return c.json({ error: "New password must be at least 8 characters" }, 400);
  }
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
    .bind(c.get("user").id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(body.current, row.password_hash))) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }
  const hash = await createPasswordHash(body.new_password);
  await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .bind(hash, c.get("user").id)
    .run();
  return c.json({ ok: true });
});