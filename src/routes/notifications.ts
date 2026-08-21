import { Hono } from "hono";
import type { AppContext } from "../types";
import { requireAuth } from "../lib/auth";

export const notificationsRoutes = new Hono<AppContext>();

notificationsRoutes.use("*", requireAuth);

notificationsRoutes.get("/", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
  )
    .bind(c.get("user").id, limit)
    .all();
  const unread = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0"
  )
    .bind(c.get("user").id)
    .first<{ n: number }>();
  return c.json({ notifications: results, unread_count: unread?.n ?? 0 });
});

notificationsRoutes.post("/:id/read", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?")
    .bind(id, c.get("user").id)
    .run();
  return c.json({ ok: true });
});

notificationsRoutes.post("/read-all", async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?")
    .bind(c.get("user").id)
    .run();
  return c.json({ ok: true });
});