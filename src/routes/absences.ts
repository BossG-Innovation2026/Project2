import { Hono } from "hono";
import type { AppContext, AppEnv, SessionUser, Variables } from "../types";
import { requireAuth, requireAdmin, notifyUser, getPeriodCount } from "../lib/auth";
import { isValidDate, nowISO } from "../lib/dates";
import { findCandidates } from "../services/matching";

interface RecommendCtx {
  env: AppEnv;
  get: <K extends keyof Variables>(key: K) => Variables[K];
}

export const absencesRoutes = new Hono<AppContext>();

absencesRoutes.use("*", requireAuth);

absencesRoutes.get("/", async (c) => {
  const status = c.req.query("status");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const teacherId = c.req.query("teacher_id");

  let sql = `SELECT a.id, a.teacher_id, u.name AS teacher_name, a.date, a.period, a.reason,
                     a.status, a.requested_by, a.reviewed_by, a.reviewed_at, a.created_at,
                     (SELECT GROUP_CONCAT(r_u.name, ', ')
                      FROM relief_assignments r JOIN users r_u ON r_u.id = r.reliever_id
                      WHERE r.absence_id = a.id AND r.status IN ('assigned','accepted','overridden')) AS reliever_names
             FROM absences a JOIN users u ON u.id = a.teacher_id`;
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (status) {
    clauses.push("a.status = ?");
    params.push(status);
  }
  if (from && isValidDate(from)) {
    clauses.push("a.date >= ?");
    params.push(from);
  }
  if (to && isValidDate(to)) {
    clauses.push("a.date <= ?");
    params.push(to);
  }
  if (teacherId) {
    clauses.push("a.teacher_id = ?");
    params.push(Number(teacherId));
  }
  if (c.get("user").role === "teacher") {
    clauses.push("a.teacher_id = ?");
    params.push(c.get("user").id);
  }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY a.date DESC, a.period ASC";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ absences: results });
});

/**
 * My leave requests with status + assigned reliever(s).
 * Scoped to the authenticated user (teacher sees own; admin sees own too).
 * NOTE: registered before /:id so "my-leaves" isn't treated as an id.
 */
absencesRoutes.get("/my-leaves", async (c) => {
  const userId = c.get("user").id;
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.date, a.period, a.reason, a.status, a.created_at,
            (SELECT GROUP_CONCAT(u.name, ', ')
             FROM relief_assignments r JOIN users u ON u.id = r.reliever_id
             WHERE r.absence_id = a.id AND r.status IN ('accepted','overridden')) AS reliever_names
     FROM absences a
     WHERE a.teacher_id = ?
     ORDER BY a.date DESC, a.period ASC
     LIMIT 50`
  )
    .bind(userId)
    .all<{ id: number; date: string; period: number; reason: string; status: string; created_at: string; reliever_names: string | null }>();
  return c.json({ leaves: results });
});

absencesRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare(
    `SELECT a.*, u.name AS teacher_name FROM absences a JOIN users u ON u.id = a.teacher_id WHERE a.id = ?`
  )
    .bind(id)
    .first<{ teacher_id: number }>();
  if (!row) return c.json({ error: "Leave not found" }, 404);
  if (c.get("user").role !== "admin" && row.teacher_id !== c.get("user").id) {
    return c.json({ error: "Forbidden" }, 403);
  }
  return c.json({ absence: row });
});

/**
 * Create an absence request. Teachers can only create for themselves;
 * admins can create for any teacher and can skip the approval step (status approved).
 * Accepts either `period` (single) or `periods` (array of period numbers).
 */
absencesRoutes.post("/", async (c) => {
  const body = await c.req.json<{
    teacher_id?: number;
    date: string;
    period?: number;
    periods?: number[];
    reason?: string;
    status?: "pending" | "approved";
  }>();
  if (!isValidDate(body.date)) {
    return c.json({ error: "Invalid date" }, 400);
  }

  const teacherId = body.teacher_id ?? c.get("user").id;
  if (c.get("user").role !== "admin" && teacherId !== c.get("user").id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const pc = await getPeriodCount(c.env.DB);

  // Normalize to a periods array
  let periods: number[];
  if (body.periods && Array.isArray(body.periods) && body.periods.length > 0) {
    periods = body.periods.filter((p) => p >= 1 && p <= pc);
    if (periods.length === 0) return c.json({ error: "No valid periods provided" }, 400);
  } else if (body.period != null && body.period >= 1 && body.period <= pc) {
    periods = [body.period];
  } else {
    return c.json({ error: "Invalid period(s)" }, 400);
  }

  const wantStatus = c.get("user").role === "admin" ? body.status ?? "approved" : "pending";

  // Check for duplicates across all requested periods
  const createdIds: number[] = [];
  const skippedPeriods: number[] = [];
  const duplicates: number[] = [];

  for (const period of periods) {
    const dup = await c.env.DB.prepare(
      `SELECT id FROM absences WHERE teacher_id = ? AND date = ? AND period = ?
       AND status != 'declined'`
    )
      .bind(teacherId, body.date, period)
      .first();
    if (dup) {
      duplicates.push(period);
      continue;
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO absences (teacher_id, date, period, reason, status, requested_by, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (teacher_id, date, period) DO NOTHING`
    )
      .bind(
        teacherId,
        body.date,
        period,
        body.reason ?? "",
        wantStatus,
        c.get("user").id,
        wantStatus === "approved" ? c.get("user").id : null,
        wantStatus === "approved" ? nowISO() : null
      )
      .run();
    if (result.meta.changes === 0) {
      duplicates.push(period);
      continue;
    }
    createdIds.push(Number(result.meta.last_row_id));
  }

  if (createdIds.length === 0 && duplicates.length > 0) {
    return c.json({ error: `Leaves already exist for periods: ${duplicates.join(", ")}` }, 409);
  }

  const teacher = await c.env.DB.prepare("SELECT name FROM users WHERE id = ?")
    .bind(teacherId)
    .first<{ name: string }>();

  const periodLabel = periods.length === 1
    ? `Period ${periods[0]}`
    : `Periods ${periods.join(", ")}`;

  if (wantStatus === "approved") {
    // Notify teacher and recommend relievers for each absence
    await notifyUser(
      c.env.DB,
      teacherId,
      "absence_approved",
      `Your leave on ${body.date} (${periodLabel}) was approved.`
    );
    for (const absenceId of createdIds) {
      await recommendForAbsence(c, absenceId);
    }
  } else {
    const admins = await c.env.DB.prepare("SELECT id FROM users WHERE role = 'admin'").all<{ id: number }>();
    for (const a of admins.results) {
      await notifyUser(
        c.env.DB,
        a.id,
        "absence_request",
        `${teacher?.name ?? "A teacher"} requested leave on ${body.date} (${periodLabel}).`,
        "/requests"
      );
    }
  }

  return c.json({ ids: createdIds, duplicates }, 201);
});

/**
 * Approve or decline an absence (admin only). Approval triggers automatic
 * recommendation of relievers.
 */
absencesRoutes.put("/:id/status", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ status: "approved" | "declined" }>();
  if (!["approved", "declined"].includes(body.status)) {
    return c.json({ error: "Invalid status" }, 400);
  }
  const absence = await c.env.DB.prepare(
    `SELECT a.*, u.name AS teacher_name FROM absences a JOIN users u ON u.id = a.teacher_id WHERE a.id = ?`
  )
    .bind(id)
    .first<{
      teacher_id: number;
      teacher_name: string;
      date: string;
      period: number;
      status: string;
    }>();
  if (!absence) return c.json({ error: "Leave not found" }, 404);

  await c.env.DB.prepare(
    "UPDATE absences SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?"
  )
    .bind(body.status, c.get("user").id, nowISO(), id)
    .run();

  if (body.status === "approved") {
    await notifyUser(
      c.env.DB,
      absence.teacher_id,
      "absence_approved",
      `Your leave on ${absence.date} (Period ${absence.period}) was approved.`,
      "/requests"
    );
    await recommendForAbsence(c, id);
  } else {
    await notifyUser(
      c.env.DB,
      absence.teacher_id,
      "absence_declined",
      `Your leave on ${absence.date} (Period ${absence.period}) was declined.`,
      "/requests"
    );
  }
  return c.json({ ok: true });
});

async function recommendForAbsence(c: RecommendCtx, absenceId: number): Promise<void> {
  const absence = await c.env.DB.prepare("SELECT * FROM absences WHERE id = ?")
    .bind(absenceId)
    .first<{ teacher_id: number; date: string; period: number; status: string }>();
  if (!absence || absence.status !== "approved") return;

  const existing = await c.env.DB.prepare(
    "SELECT id FROM relief_assignments WHERE absence_id = ? AND status != 'declined'"
  )
    .bind(absenceId)
    .first();
  if (existing) return;

  const candidates = await findCandidates(c.env, absence.teacher_id, absence.date, absence.period, 3);
  for (const cand of candidates) {
    await c.env.DB.prepare(
      `INSERT INTO relief_assignments (absence_id, reliever_id, date, period, subject, class_name, status, is_override, created_by)
       VALUES (?, ?, ?, ?, '', '', 'recommended', 0, ?)`
    )
      .bind(absenceId, cand.teacher_id, absence.date, absence.period, c.get("user").id)
      .run();
  }
}