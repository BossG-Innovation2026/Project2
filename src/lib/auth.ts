import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppContext, AppEnv, SessionUser, Variables } from "../types";

const SESSION_COOKIE = "trace_session";
const SESSION_TTL = 60 * 60 * 24 * 7;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length / 2);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

export function randomHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: 100_000, hash: "SHA-256" },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function createPasswordHash(password: string): Promise<string> {
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  return `pbkdf2:100000:${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const candidate = await hashPassword(password, parts[2]);
  return candidate === parts[3];
}

export async function createSession(c: Context<AppContext>, userId: number): Promise<string> {
  const token = randomHex(32);
  await c.env.SESSIONS.put(`session:${token}`, JSON.stringify({ userId }), {
    expirationTtl: SESSION_TTL,
  });
  return token;
}

export function setSessionCookie(c: Context<AppContext>, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    maxAge: SESSION_TTL,
  });
}

export function clearSessionCookie(c: Context<AppContext>) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function getSessionUser(c: Context<AppContext>): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const raw = await c.env.SESSIONS.get(`session:${token}`);
  if (!raw) return null;
  const { userId } = JSON.parse(raw) as { userId: number };
  const row = await c.env.DB.prepare(
    "SELECT id, name, email, role FROM users WHERE id = ? AND active = 1"
  )
    .bind(userId)
    .first<SessionUser>();
  return row ?? null;
}

export const requireAuth = createMiddleware<{ Bindings: AppEnv; Variables: Variables }>(
  async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const raw = await c.env.SESSIONS.get(`session:${token}`);
    if (!raw) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const { userId } = JSON.parse(raw) as { userId: number };
    const user = await c.env.DB.prepare(
      "SELECT id, name, email, role FROM users WHERE id = ? AND active = 1"
    )
      .bind(userId)
      .first<SessionUser>();
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("user", user);
    c.set("sessionToken", token);
    await next();
  }
);

export const requireAdmin = createMiddleware<{ Bindings: AppEnv; Variables: Variables }>(
  async (c, next) => {
    if (c.get("user").role !== "admin") {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  }
);

export type AuthMiddleware = typeof requireAuth;
export type AdminMiddleware = typeof requireAdmin;

export async function notifyUser(
  db: D1Database,
  userId: number,
  type: string,
  message: string,
  link = ""
): Promise<void> {
  await db
    .prepare("INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)")
    .bind(userId, type, message, link)
    .run();
}

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const r of results) out[r.key] = r.value;
  return out;
}

export async function getPeriodCount(db: D1Database): Promise<number> {
  const s = await getSettings(db);
  return parseInt(s.period_count || "8", 10) || 8;
}

export async function getPeriodNames(db: D1Database): Promise<string[]> {
  const s = await getSettings(db);
  try {
    const parsed = JSON.parse(s.period_names || "[]") as string[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // fall through
  }
  const count = await getPeriodCount(db);
  return Array.from({ length: count }, (_, i) => `Period ${i + 1}`);
}