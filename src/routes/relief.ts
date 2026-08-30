import { Hono } from "hono";
import type { AppContext, Variables } from "../types";
import { requireAuth, requireAdmin, notifyUser } from "../lib/auth";
import { nowISO } from "../lib/dates";
import { detectConflicts, conflictSummary } from "../services/conflicts";
import { findCandidates } from "../services/matching";

export const reliefRoutes = new Hono<AppContext>();

reliefRoutes.use("*", requireAuth);

reliefRoutes.get("/", requireAuth, async (c) => {
  const absenceId = c.req.query("absence_id");
  const mine = c.req.query("mine");
  const status = c.req.query("status");
  const from = c.req.query("from");
  const to = c.req.query("to");

  let sql = `SELECT r.id, r.absence_id, r.reliever_id, r.date, r.period, r.subject, r.class_name,
                    r.status, r.is_override, r.created_by, r.created_at, r.updated_at,
                    u.name AS reliever_name, a.teacher_id AS absent_teacher_id,
                    au.name AS absent_teacher_name
             FROM relief_assignments r
             JOIN users u ON u.id = r.reliever_id
             JOIN absences a ON a.id = r.absence_id
             JOIN users au ON au.id = a.teacher_id`;
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (absenceId) {
    clauses.push("r.absence_id = ?");
    params.push(Number(absenceId));
  }
  if (mine === "1") {
    clauses.push("r.reliever_id = ?");
    params.push(c.get("user").id);
  }
  if (status) {
    clauses.push("r.status = ?");
    params.push(status);
  }
  if (from) {
    clauses.push("r.date >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("r.date <= ?");
    params.push(to);
  }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY r.date DESC, r.period ASC, r.created_at DESC";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ assignments: results });
});

/**
 * Ranked candidate list for an approved absence (admin view).
 */
reliefRoutes.get("/candidates/:absenceId", requireAdmin, async (c) => {
  const absenceId = Number(c.req.param("absenceId"));
  const absence = await c.env.DB.prepare(
    "SELECT a.*, u.name AS teacher_name FROM absences a JOIN users u ON u.id = a.teacher_id WHERE a.id = ?"
  )
    .bind(absenceId)
    .first<{ teacher_id: number; teacher_name: string; date: string; period: number; status: string }>();
  if (!absence) return c.json({ error: "Leave not found" }, 404);
  const candidates = await findCandidates(c.env, absence.teacher_id, absence.date, absence.period, 10);
  return c.json({ absence, candidates });
});

/**
 * Assign a reliever to an approved absence (admin).
 * Body: { reliever_id, override?: boolean }
 * With override=true the normal conflict check is bypassed and the assignment
 * is flagged as an admin override.
 */
reliefRoutes.post("/assign", requireAdmin, async (c) => {
  const body = await c.req.json<{ absence_id: number; reliever_id: number; override?: boolean }>();
  if (!body.absence_id || !body.reliever_id) {
    return c.json({ error: "absence_id and reliever_id are required" }, 400);
  }
  const absence = await c.env.DB.prepare(
    `SELECT a.*, s.subject, s.class_name, u.name AS teacher_name
     FROM absences a
     LEFT JOIN schedules s ON s.teacher_id = a.teacher_id AND s.weekday = (SELECT (CAST(strftime('%w', a.date) AS INTEGER) + 6) % 7) AND s.period = a.period
     JOIN users u ON u.id = a.teacher_id
     WHERE a.id = ?`
  )
    .bind(body.absence_id)
    .first<{
      id: number;
      teacher_id: number;
      date: string;
      period: number;
      status: string;
      subject: string;
      class_name: string;
      teacher_name: string;
    }>();

  if (!absence) return c.json({ error: "Leave not found" }, 404);
  if (absence.status !== "approved") {
    return c.json({ error: "Leave must be approved before assignment" }, 400);
  }
  if (absence.teacher_id === body.reliever_id) {
    return c.json({ error: "The teacher on leave cannot cover their own leave" }, 400);
  }

  const isOverride = body.override === true;
  if (!isOverride) {
    const conflicts = await detectConflicts(c.env, body.reliever_id, absence.date, absence.period);
    if (conflicts.length > 0) {
      return c.json({ error: "Conflict detected", conflicts }, 409);
    }
  }

  // retire any recommended rows for this absence, then insert the assignment
  await c.env.DB.prepare(
    "DELETE FROM relief_assignments WHERE absence_id = ? AND status = 'recommended'"
  )
    .bind(body.absence_id)
    .run();

  const existing = await c.env.DB.prepare(
    `SELECT id FROM relief_assignments WHERE absence_id = ? AND status IN ('assigned','accepted','overridden')`
  )
    .bind(body.absence_id)
    .first<{ id: number }>();

  let assignmentId: number;
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE relief_assignments SET reliever_id = ?, status = ?, is_override = ?, created_by = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(body.reliever_id, isOverride ? "overridden" : "assigned", isOverride ? 1 : 0, c.get("user").id, nowISO(), existing.id)
      .run();
    assignmentId = existing.id;
  } else {
    const result = await c.env.DB.prepare(
      `INSERT INTO relief_assignments (absence_id, reliever_id, date, period, subject, class_name, status, is_override, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        body.absence_id,
        body.reliever_id,
        absence.date,
        absence.period,
        absence.subject ?? "",
        absence.class_name ?? "",
        isOverride ? "overridden" : "assigned",
        isOverride ? 1 : 0,
        c.get("user").id,
        nowISO()
      )
      .run();
    assignmentId = Number(result.meta.last_row_id);
  }

  const reliever = await c.env.DB.prepare("SELECT name FROM users WHERE id = ?")
    .bind(body.reliever_id)
    .first<{ name: string }>();

  await notifyUser(
    c.env.DB,
    body.reliever_id,
    "relief_assignment",
    isOverride
      ? `Admin override: you are assigned to cover ${absence.teacher_name}'s class on ${absence.date} (Period ${absence.period}).`
      : `You have been assigned to cover ${absence.teacher_name}'s class on ${absence.date} (Period ${absence.period}).`,
    "/relief"
  );
  await notifyUser(
    c.env.DB,
    absence.teacher_id,
    "relief_assigned",
    `${reliever?.name ?? "A colleague"} will cover your class on ${absence.date} (Period ${absence.period}).`,
    "/calendar"
  );

  return c.json({ id: assignmentId, override: isOverride }, 201);
});

/**
 * Teacher responds to an assignment: accept or decline.
 * Body: { status: 'accepted' | 'declined' }
 */
reliefRoutes.put("/:id/respond", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ status: "accepted" | "declined" }>();
  if (!["accepted", "declined"].includes(body.status)) {
    return c.json({ error: "Invalid status" }, 400);
  }
  const row = await c.env.DB.prepare(
    `SELECT r.*, a.teacher_id AS absent_teacher_id, u.name AS absent_teacher_name
     FROM relief_assignments r JOIN absences a ON a.id = r.absence_id JOIN users u ON u.id = a.teacher_id
     WHERE r.id = ?`
  )
    .bind(id)
    .first<{
      reliever_id: number;
      status: string;
      date: string;
      period: number;
      absent_teacher_id: number;
      absent_teacher_name: string;
    }>();
  if (!row) return c.json({ error: "Assignment not found" }, 404);
  if (row.reliever_id !== c.get("user").id && c.get("user").role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }
  if (!["assigned", "recommended", "overridden", "accepted"].includes(row.status)) {
    return c.json({ error: `Cannot respond to a ${row.status} assignment` }, 400);
  }

  await c.env.DB.prepare("UPDATE relief_assignments SET status = ?, updated_at = ? WHERE id = ?")
    .bind(body.status, nowISO(), id)
    .run();

  if (body.status === "accepted") {
    await notifyUser(
      c.env.DB,
      row.absent_teacher_id,
      "relief_accepted",
      `A reliever accepted covering your class on ${row.date} (Period ${row.period}).`,
      "/calendar"
    );
    const admins = await c.env.DB.prepare("SELECT id FROM users WHERE role = 'admin'").all<{ id: number }>();
    for (const a of admins.results) {
      await notifyUser(
        c.env.DB,
        a.id,
        "relief_accepted",
        `Relief assignment on ${row.date} (Period ${row.period}) was accepted.`,
        "/calendar"
      );
    }
  } else {
    // Reliever declined — if this absence now has no active coverage, re-run
    // recommendations so the absence isn't silently left uncovered.
    await reRecommendIfUncovered(c, row);
    const admins = await c.env.DB.prepare("SELECT id FROM users WHERE role = 'admin'").all<{ id: number }>();
    for (const a of admins.results) {
      await notifyUser(
        c.env.DB,
        a.id,
        "relief_declined",
        `A reliever declined the assignment on ${row.date} (Period ${row.period}).`,
        "/relief"
      );
    }
  }
  return c.json({ ok: true });
});

/**
 * After a decline, if the absence has no remaining active (assigned/accepted/
 * overridden) assignment, generate a fresh set of recommended relievers.
 */
async function reRecommendIfUncovered(c: { env: AppEnv; get: <K extends keyof Variables>(key: K) => Variables[K] }, row: {
  reliever_id: number;
  status: string;
  date: string;
  period: number;
  absent_teacher_id: number;
  absent_teacher_name: string;
}): Promise<void> {
  const absenceId = await c.env.DB.prepare(
    `SELECT r.absence_id FROM relief_assignments r WHERE r.date = ? AND r.period = ? AND r.reliever_id = ?
     ORDER BY r.id DESC LIMIT 1`
  )
    .bind(row.date, row.period, row.reliever_id)
    .first<{ absence_id: number }>();
  if (!absenceId) return;

  const active = await c.env.DB.prepare(
    `SELECT id FROM relief_assignments
     WHERE absence_id = ? AND status IN ('assigned','accepted','overridden')`
  )
    .bind(absenceId.absence_id)
    .first();
  if (active) return; // still covered

  const absence = await c.env.DB.prepare(
    "SELECT teacher_id, date, period, status FROM absences WHERE id = ?"
  )
    .bind(absenceId.absence_id)
    .first<{ teacher_id: number; date: string; period: number; status: string }>();
  if (!absence || absence.status !== "approved") return;

  const existing = await c.env.DB.prepare(
    "SELECT id FROM relief_assignments WHERE absence_id = ? AND status = 'recommended'"
  )
    .bind(absenceId.absence_id)
    .first();
  if (existing) return;

  const candidates = await findCandidates(c.env, absence.teacher_id, absence.date, absence.period, 3);
  for (const cand of candidates) {
    await c.env.DB.prepare(
      `INSERT INTO relief_assignments (absence_id, reliever_id, date, period, subject, class_name, status, is_override, created_by)
       VALUES (?, ?, ?, ?, '', '', 'recommended', 0, ?)`
    )
      .bind(absenceId.absence_id, cand.teacher_id, absence.date, absence.period, c.get("user").id)
      .run();
  }
}

/**
 * Conflict check preview for a specific teacher/date/period.
 */
reliefRoutes.get("/check", async (c) => {
  const teacherId = Number(c.req.query("teacher_id") ?? c.get("user").id);
  const date = c.req.query("date") ?? "";
  const period = Number(c.req.query("period") ?? 0);
  if (!date || !period) return c.json({ error: "date and period are required" }, 400);
  const conflicts = await detectConflicts(c.env, teacherId, date, period);
  return c.json({
    clear: conflicts.length === 0,
    conflicts,
    summary: conflictSummary(conflicts),
  });
});

reliefRoutes.delete("/:id", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const result = await c.env.DB.prepare("DELETE FROM relief_assignments WHERE id = ?").bind(id).run();
  if (!result.success || result.meta.changes === 0) {
    return c.json({ error: "Assignment not found" }, 404);
  }
  return c.json({ ok: true });
});