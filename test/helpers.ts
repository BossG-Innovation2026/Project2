import { SELF, env } from "cloudflare:test";
import { createPasswordHash } from "../src/lib/auth";
import { addDays, todayISO, weekdayOf } from "../src/lib/dates";
import type { AppEnv } from "../src/types";

/** Returns a weekday (Mon–Fri) date at least `days` days ahead of today. */
export function weekdayDate(days: number): string {
  let d = addDays(todayISO(), days);
  while (weekdayOf(d) > 4) d = addDays(d, 1);
  return d;
}

export const MIGRATIONS = [
  {
    name: "0001_init",
    queries: [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','teacher')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );`,
      `CREATE TABLE IF NOT EXISTS teacher_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        department TEXT NOT NULL DEFAULT '',
        subjects TEXT NOT NULL DEFAULT '',
        max_weekly_load INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        cluster TEXT NOT NULL DEFAULT '',
        room TEXT NOT NULL DEFAULT ''
      );`,
      `CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        period INTEGER NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        class_name TEXT NOT NULL DEFAULT '',
        UNIQUE (teacher_id, weekday, period)
      );`,
      `CREATE TABLE IF NOT EXISTS availability (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        period INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('available','unavailable','class')),
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (teacher_id, date, period)
      );`,
      `CREATE TABLE IF NOT EXISTS absences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        period INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
        requested_by INTEGER NOT NULL REFERENCES users(id),
        reviewed_by INTEGER REFERENCES users(id),
        reviewed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (teacher_id, date, period)
      );`,
      `CREATE TABLE IF NOT EXISTS relief_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        absence_id INTEGER NOT NULL REFERENCES absences(id) ON DELETE CASCADE,
        reliever_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        period INTEGER NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        class_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'recommended'
          CHECK (status IN ('recommended','assigned','accepted','declined','overridden')),
        is_override INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT NOT NULL DEFAULT '',
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );`,
      `INSERT OR IGNORE INTO settings (key, value) VALUES ('period_count','8');`,
      `INSERT OR IGNORE INTO settings (key, value) VALUES ('period_names','["Period 1","Period 2","Period 3","Period 4","Period 5","Period 6","Period 7","Period 8"]');`,
      `INSERT OR IGNORE INTO settings (key, value) VALUES ('school_name','CSHS');`,
      `INSERT OR IGNORE INTO settings (key, value) VALUES ('school_year','2026-2027');`,
      `INSERT OR IGNORE INTO settings (key, value) VALUES ('system_name','CSHS TRACE');`,
      `INSERT OR IGNORE INTO settings (key, value) VALUES ('system_tagline','Teacher Relief Coordination');`,
      `INSERT OR IGNORE INTO settings (key, value) VALUES ('subject_list','[]');`,
      `INSERT OR IGNORE INTO settings (key, value) VALUES ('class_list','[]');`,
      `INSERT OR IGNORE INTO settings (key, value) VALUES ('department_list','[]');`,
      `INSERT OR IGNORE INTO settings (key, value) VALUES ('class_cluster_map','{}');`,
      `CREATE INDEX IF NOT EXISTS idx_availability_lookup ON availability (date, period, status);`,
      `CREATE INDEX IF NOT EXISTS idx_absences_lookup ON absences (date, period, status);`,
      `CREATE INDEX IF NOT EXISTS idx_relief_lookup ON relief_assignments (date, period, status);`,
      `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read);`,
      `CREATE TABLE IF NOT EXISTS assets (
        name TEXT PRIMARY KEY,
        content_type TEXT NOT NULL,
        data BLOB NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );`,
    ],
  },
];

/** Applies the schema (idempotent) then seeds a known-good dataset. Call in beforeAll. */
export async function initDb(): Promise<SeedIds> {
  await applyMigrations();
  return seedBaseData();
}

export interface SeedIds {
  adminId: number;
  teacherA: number;
  teacherB: number;
  teacherC: number;
}

/** Applies the schema migrations (idempotent). */
export async function applyMigrations(): Promise<void> {
  for (const migration of MIGRATIONS) {
    for (const query of migration.queries) {
      await (env.DB as any).prepare(query).run();
    }
  }
}

export const adminUser = { id: 1, name: "Admin", email: "admin@cshs.edu", role: "admin" };
export const teacherUser = { id: 2, name: "Teacher A", email: "teacher.a@cshs.edu", role: "teacher" };

/** Creates a request to the worker and returns { status, json, headers }. */
export async function request(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; json: () => Promise<any>; text: () => Promise<string>; headers: Headers }> {
  const { method = "GET", body, headers } = options;
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers = { ...(init.headers as Record<string, string>), "Content-Type": "application/json" };
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const res = await SELF.fetch(new Request(`http://localhost${path}`, init));
  return { status: res.status, json: () => res.json(), text: () => res.text(), headers: res.headers };
}

/** Logs in and returns a fresh session cookie value. */
export async function login(email: string, password: string): Promise<string> {  const res = await SELF.fetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
  );
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get("Set-Cookie") ?? "";
  const match = cookie.match(/trace_session=([^;]+)/);
  if (!match) throw new Error("No session cookie returned");
  return match[1];
}

/** Helper to include the session cookie in a request. */
export function authHeaders(token: string): Record<string, string> {
  return { Cookie: `trace_session=${token}` };
}

/** Inserts a teacher directly into the local test DB (bypasses password hashing complexity). */
export async function createTestUser(opts: {
  name: string;
  email: string;
  role?: "admin" | "teacher";
  password?: string;
  department?: string;
  subjects?: string;
  cluster?: string;
  room?: string;
  maxWeeklyLoad?: number;
}): Promise<number> {
  const hash = opts.password ? await createPasswordHash(opts.password) : `pbkdf2:100000:test:${opts.email}`;
  const usersRes = await (env.DB as any)
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, ?, 1)`
    )
    .bind(opts.name, opts.email, hash, opts.role ?? "teacher")
    .run();
  const userId = Number((usersRes as any).meta.last_row_id);
  await (env.DB as any)
    .prepare(
      `INSERT INTO teacher_profiles (user_id, department, subjects, cluster, room, max_weekly_load) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(userId, opts.department ?? "", opts.subjects ?? "", opts.cluster ?? "", opts.room ?? "", opts.maxWeeklyLoad ?? 0)
    .run();
  return userId;
}

/** Seeds a minimal known-good dataset: 1 admin (pw 'adminpass1'), 3 teachers (pw 'teacherpass1'). Idempotent. */
export async function seedBaseData(): Promise<void> {
  // Clear existing data so re-runs are deterministic
  await (env.DB as any).prepare("DELETE FROM relief_assignments").run();
  await (env.DB as any).prepare("DELETE FROM absences").run();
  await (env.DB as any).prepare("DELETE FROM availability").run();
  await (env.DB as any).prepare("DELETE FROM schedules").run();
  await (env.DB as any).prepare("DELETE FROM notifications").run();
  await (env.DB as any).prepare("DELETE FROM teacher_profiles").run();
  await (env.DB as any).prepare("DELETE FROM users").run();
  await (env.DB as any).prepare("DELETE FROM sqlite_sequence WHERE name IN ('users','teacher_profiles','schedules','availability','absences','relief_assignments','notifications')").run();

  const adminHash = await createPasswordHash("adminpass1");
  const teacherHash = await createPasswordHash("teacherpass1");
  // Admin
  const adminId = Number((await (env.DB as any)
    .prepare(`INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, 'admin', 1)`)
    .bind("Admin", "admin@cshs.edu", adminHash)
    .run()).meta.last_row_id);
  // Teachers
  const tA = Number((await (env.DB as any)
    .prepare(`INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, 'teacher', 1)`)
    .bind("Teacher A", "teacher.a@cshs.edu", teacherHash)
    .run()).meta.last_row_id);
  const tB = Number((await (env.DB as any)
    .prepare(`INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, 'teacher', 1)`)
    .bind("Teacher B", "teacher.b@cshs.edu", teacherHash)
    .run()).meta.last_row_id);
  const tC = Number((await (env.DB as any)
    .prepare(`INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, 'teacher', 1)`)
    .bind("Teacher C", "teacher.c@cshs.edu", teacherHash)
    .run()).meta.last_row_id);

  await (env.DB as any)
    .prepare(
      `INSERT INTO teacher_profiles (user_id, department, subjects, cluster, room, max_weekly_load) VALUES (?, 'Admin', '', '', '', 0)`
    )
    .bind(adminId)
    .run();
  await (env.DB as any)
    .prepare(
      `INSERT INTO teacher_profiles (user_id, department, subjects, cluster, room, max_weekly_load) VALUES (?, 'Math', 'Gen-Math', 'B1', '101', 20)`
    )
    .bind(tA)
    .run();
  await (env.DB as any)
    .prepare(
      `INSERT INTO teacher_profiles (user_id, department, subjects, cluster, room, max_weekly_load) VALUES (?, 'Science', 'Gen-Sci', 'B2', '201', 20)`
    )
    .bind(tB)
    .run();
  await (env.DB as any)
    .prepare(
      `INSERT INTO teacher_profiles (user_id, department, subjects, cluster, room, max_weekly_load) VALUES (?, 'History', 'History', 'B3', '301', 20)`
    )
    .bind(tC)
    .run();

  return { adminId, teacherA: tA, teacherB: tB, teacherC: tC };
}

export type { AppEnv };
