import { Hono } from "hono";
import type { AppContext } from "../types";
import { requireAuth, requireAdmin } from "../lib/auth";

export const assetsRoutes = new Hono<AppContext>();

const ALLOWED = new Set(["logo", "background"]);
const MAX_BYTES = 2 * 1024 * 1024;
const MIME_WHITELIST = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

assetsRoutes.get("/:name", async (c) => {
  const name = c.req.param("name");
  if (!ALLOWED.has(name)) return c.json({ error: "Unknown asset" }, 404);
  const row = await c.env.DB.prepare(
    "SELECT content_type, data FROM assets WHERE name = ?"
  )
    .bind(name)
    .first<{ content_type: string; data: Uint8Array }>();
  if (!row) return c.json({ error: "Not found" }, 404);
  const bytes = row.data instanceof Uint8Array ? row.data : new TextEncoder().encode(String(row.data));
  return new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
    headers: {
      "Content-Type": row.content_type,
      "Cache-Control": "public, max-age=60",
    },
  });
});

assetsRoutes.put("/:name", requireAuth, requireAdmin, async (c) => {
  const name = c.req.param("name");
  if (!ALLOWED.has(name)) return c.json({ error: "Unknown asset" }, 404);

  let contentType = "";
  let bytes: ArrayBuffer;
  try {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) {
      return c.json({ error: "No file uploaded" }, 400);
    }
    contentType = file.type;
    bytes = await file.arrayBuffer();
  } catch {
    return c.json({ error: "Invalid upload" }, 400);
  }

  if (!MIME_WHITELIST.has(contentType)) {
    return c.json({ error: "Only PNG, JPEG, WebP or SVG images are allowed" }, 400);
  }
  if (bytes.byteLength === 0) return c.json({ error: "Empty file" }, 400);
  if (bytes.byteLength > MAX_BYTES) {
    return c.json({ error: "Image must be 2 MB or smaller" }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO assets (name, content_type, data, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET
       content_type = excluded.content_type,
       data = excluded.data,
       updated_at = excluded.updated_at`
  )
    .bind(name, contentType, new Uint8Array(bytes))
    .run();

  return c.json({ ok: true });
});

assetsRoutes.delete("/:name", requireAuth, requireAdmin, async (c) => {
  const name = c.req.param("name");
  if (!ALLOWED.has(name)) return c.json({ error: "Unknown asset" }, 404);
  const result = await c.env.DB.prepare("DELETE FROM assets WHERE name = ?").bind(name).run();
  if (!result.success || result.meta.changes === 0) {
    return c.json({ error: "Asset not found" }, 404);
  }
  return c.json({ ok: true });
});
