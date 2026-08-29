import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import type { AppEnv, Variables } from "./types";
import { authRoutes } from "./routes/auth";
import { settingsRoutes } from "./routes/settings";
import { assetsRoutes } from "./routes/assets";
import { teachersRoutes } from "./routes/teachers";
import { schedulesRoutes } from "./routes/schedules";
import { availabilityRoutes } from "./routes/availability";
import { absencesRoutes } from "./routes/absences";
import { reliefRoutes } from "./routes/relief";
import { notificationsRoutes } from "./routes/notifications";
import { reportsRoutes } from "./routes/reports";
import { requireAuth, notifyUser, getPeriodNames } from "./lib/auth";
import { addDays, todayISO } from "./lib/dates";
import { findCandidates } from "./services/matching";
import { getSummary } from "./routes/reports";

const app = new Hono<{ Bindings: AppEnv; Variables: Variables }>();

app.use("*", logger());
app.use("/api/*", cors());

app.route("/api/auth", authRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/assets", assetsRoutes);
app.route("/api/teachers", teachersRoutes);
app.route("/api/schedules", schedulesRoutes);
app.route("/api/availability", availabilityRoutes);
app.route("/api/absences", absencesRoutes);
app.route("/api/relief", reliefRoutes);
app.route("/api/notifications", notificationsRoutes);
app.route("/api/reports", reportsRoutes);

app.get("/api/health", (c) => c.json({ ok: true, service: "cshs-trace" }));

app.get("/api/dashboard", requireAuth, async (c) => {
  const user = c.get("user");
  const today = todayISO();
  const weekAhead = addDays(today, 7);

  const { results: myAbsences } = await c.env.DB.prepare(
    `SELECT id, date, period, reason, status FROM absences
     WHERE teacher_id = ? AND date >= ? ORDER BY date ASC, period ASC LIMIT 5`
  )
    .bind(user.id, today)
    .all();

  const { results: myAssignments } = await c.env.DB.prepare(
    `SELECT r.id, r.date, r.period, r.subject, r.class_name, r.status, a.teacher_id AS absent_teacher_id,
            u.name AS absent_teacher_name
     FROM relief_assignments r
     JOIN absences a ON a.id = r.absence_id
     JOIN users u ON u.id = a.teacher_id
     WHERE r.reliever_id = ? AND r.date >= ?
       AND r.status IN ('assigned','accepted','overridden','recommended')
     ORDER BY r.date ASC, r.period ASC LIMIT 10`
  )
    .bind(user.id, today)
    .all();

  const summary = await getSummary(c.env.DB);

  const reliefHoursRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM relief_assignments
     WHERE reliever_id = ? AND status = 'accepted'`
  )
    .bind(user.id)
    .first<{ cnt: number }>();
  const leaveHoursRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM absences
     WHERE teacher_id = ? AND status = 'approved'`
  )
    .bind(user.id)
    .first<{ cnt: number }>();

  const { results: upcomingAbsences } = await c.env.DB.prepare(
    `SELECT a.id, a.date, a.period, a.reason, u.name AS teacher_name,
            (SELECT COUNT(*) FROM relief_assignments r
             WHERE r.absence_id = a.id AND r.status IN ('assigned','accepted','overridden')) AS assigned_count
     FROM absences a JOIN users u ON u.id = a.teacher_id
     WHERE a.date BETWEEN ? AND ? AND a.status = 'approved'
     ORDER BY a.date ASC, a.period ASC LIMIT 10`
  )
    .bind(today, weekAhead)
    .all();

  return c.json({
    user,
    my_absences: myAbsences,
    my_assignments: myAssignments,
    upcoming_absences: upcomingAbsences,
    summary,
    relief_hours: reliefHoursRow?.cnt ?? 0,
    leave_hours: leaveHoursRow?.cnt ?? 0,
    period_count: (await getPeriodNames(c.env.DB)).length,
    period_names: await getPeriodNames(c.env.DB),
  });
});

app.get("/api/periods", requireAuth, async (c) => {
  const names = await getPeriodNames(c.env.DB);
  return c.json({ period_count: names.length, period_names: names });
});

/**
 * Static asset serving for the built SPA with history fallback.
 */
app.all("*", async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith("/api/")) {
    return c.json({ error: "Not found" }, 404);
  }
  const accept = c.req.header("Accept") ?? "";
  const wantsHtml = accept.includes("text/html");

  let res: Response;
  if (url.pathname === "/") {
    res = await c.env.ASSETS.fetch(new Request(`${url.origin}/index.html`, c.req.raw));
  } else {
    const target = `${url.origin}${url.pathname}`;
    res = await c.env.ASSETS.fetch(new Request(target, c.req.raw));
    const hasExtension = /\.[a-zA-Z0-9]{1,8}$/.test(url.pathname);
    if (res.status === 404 && (wantsHtml || !hasExtension)) {
      res = await c.env.ASSETS.fetch(new Request(`${url.origin}/index.html`, c.req.raw));
    }
  }
  return res;
});

/**
 * Nightly cron: pre-compute recommendations for approved absences that have
 * no reliever yet, and notify admins of upcoming uncovered periods.
 */
async function nightlyMaintenance(AppEnv: AppEnv): Promise<void> {
  const today = todayISO();
  const nextWeek = addDays(today, 7);

  const { results: uncovered } = await AppEnv.DB.prepare(
    `SELECT a.id, a.teacher_id, a.date, a.period, u.name AS teacher_name
     FROM absences a JOIN users u ON u.id = a.teacher_id
     WHERE a.status = 'approved'
       AND a.date BETWEEN ? AND ?
       AND NOT EXISTS (
         SELECT 1 FROM relief_assignments r
         WHERE r.absence_id = a.id AND r.status IN ('assigned','accepted','overridden')
       )
     ORDER BY a.date ASC, a.period ASC`
  )
    .bind(today, nextWeek)
    .all<{ id: number; teacher_id: number; date: string; period: string; teacher_name: string }>();

  for (const abs of uncovered) {
    const existing = await AppEnv.DB.prepare(
      "SELECT id FROM relief_assignments WHERE absence_id = ? AND status = 'recommended'"
    )
      .bind(abs.id)
      .first();
    if (existing) continue;

    const candidates = await findCandidates(AppEnv, abs.teacher_id, abs.date, Number(abs.period), 3);
    for (const cand of candidates) {
      await AppEnv.DB.prepare(
        `INSERT INTO relief_assignments (absence_id, reliever_id, date, period, subject, class_name, status, is_override, created_by)
         VALUES (?, ?, ?, ?, '', '', 'recommended', 0, 1)`
      )
        .bind(abs.id, cand.teacher_id, abs.date, Number(abs.period))
        .run();
    }
  }

  if (uncovered.length > 0) {
    const admins = await AppEnv.DB.prepare("SELECT id FROM users WHERE role = 'admin'").all<{ id: number }>();
    for (const a of admins.results) {
      await notifyUser(
        AppEnv.DB,
        a.id,
        "daily_summary",
        `${uncovered.length} approved leave(s) in the next 7 days still need a reliever.`,
        "/relief"
      );
    }
  }
}

export default {
  fetch: app.fetch,
  scheduled: async (controller: ScheduledController, AppEnv: AppEnv) => {
    await nightlyMaintenance(AppEnv);
  },
} satisfies ExportedHandler<AppEnv>;