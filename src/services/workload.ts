import type { AppEnv } from "../types";
import { startOfWeek, endOfWeek } from "../lib/dates";

export interface WorkloadRow {
  teacher_id: number;
  name: string;
  department: string;
  subjects: string;
  max_weekly_load: number;
  scheduled_periods: number;
  relief_this_week: number;
  relief_all_time: number;
  total_current: number;
  utilization: number;
}

/**
 * Weekly workload = scheduled classes + relief assignments within the week.
 * Utilization = total current load vs. configured max weekly load.
 */
export async function getWorkload(AppEnv: AppEnv, date: string): Promise<WorkloadRow[]> {
  const weekStart = startOfWeek(date);
  const weekEnd = endOfWeek(date);

  const { results: teachers } = await AppEnv.DB.prepare(
    `SELECT u.id, u.name, tp.department, tp.subjects, tp.max_weekly_load
     FROM users u
     LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
     WHERE u.role = 'teacher' AND u.active = 1
     ORDER BY u.name`
  ).all<{
    id: number;
    name: string;
    department: string;
    subjects: string;
    max_weekly_load: number;
  }>();

  const out: WorkloadRow[] = [];
  for (const t of teachers) {
    const sched = await AppEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM schedules WHERE teacher_id = ?"
    )
      .bind(t.id)
      .first<{ n: number }>();

    const reliefWeek = await AppEnv.DB.prepare(
      `SELECT COUNT(*) AS n FROM relief_assignments
       WHERE reliever_id = ? AND date BETWEEN ? AND ?
         AND status IN ('assigned', 'accepted', 'overridden')`
    )
      .bind(t.id, weekStart, weekEnd)
      .first<{ n: number }>();

    const reliefAll = await AppEnv.DB.prepare(
      `SELECT COUNT(*) AS n FROM relief_assignments
       WHERE reliever_id = ? AND status IN ('assigned', 'accepted', 'overridden')`
    )
      .bind(t.id)
      .first<{ n: number }>();

    const scheduled = sched?.n ?? 0;
    const rw = reliefWeek?.n ?? 0;
    const ra = reliefAll?.n ?? 0;
    const total = scheduled + rw;
    const maxLoad = t.max_weekly_load ?? 0;

    out.push({
      teacher_id: t.id,
      name: t.name,
      department: t.department ?? "",
      subjects: t.subjects ?? "",
      max_weekly_load: maxLoad,
      scheduled_periods: scheduled,
      relief_this_week: rw,
      relief_all_time: ra,
      total_current: total,
      utilization: maxLoad > 0 ? Math.round((total / maxLoad) * 100) : 0,
    });
  }
  return out;
}