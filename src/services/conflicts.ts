import type { AppEnv } from "../types";
import { weekdayOf } from "../lib/dates";

export interface Conflict {
  type: "schedule" | "relief" | "absence" | "unavailable";
  detail: string;
}

/**
 * Detects whether a teacher can cover a given date/period without conflicts.
 * A teacher cannot cover when:
 *  - they have a scheduled class at that weekday/period
 *  - they are already assigned to relieve someone at that date/period
 *  - they have an approved absence at that date/period
 *  - they explicitly marked themselves unavailable at that date/period
 */
export async function detectConflicts(
  AppEnv: AppEnv,
  teacherId: number,
  date: string,
  period: number
): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];

  const schedule = await AppEnv.DB.prepare(
    "SELECT subject, class_name FROM schedules WHERE teacher_id = ? AND weekday = ? AND period = ?"
  )
    .bind(teacherId, weekdayOf(date), period)
    .first<{ subject: string; class_name: string }>();
  if (schedule) {
    conflicts.push({
      type: "schedule",
      detail: `Has ${schedule.subject} (${schedule.class_name}) at this period`,
    });
  }

  const relief = await AppEnv.DB.prepare(
    `SELECT id FROM relief_assignments
     WHERE reliever_id = ? AND date = ? AND period = ?
       AND status IN ('assigned', 'accepted', 'overridden')`
  )
    .bind(teacherId, date, period)
    .first<{ id: number }>();
  if (relief) {
    conflicts.push({ type: "relief", detail: "Already assigned to relieve someone at this period" });
  }

  const absence = await AppEnv.DB.prepare(
    `SELECT id FROM absences WHERE teacher_id = ? AND date = ? AND period = ? AND status = 'approved'`
  )
    .bind(teacherId, date, period)
    .first<{ id: number }>();
  if (absence) {
    conflicts.push({ type: "absence", detail: "Has an approved leave at this period" });
  }

  const avail = await AppEnv.DB.prepare(
    "SELECT status FROM availability WHERE teacher_id = ? AND date = ? AND period = ?"
  )
    .bind(teacherId, date, period)
    .first<{ status: string }>();
  if (avail && avail.status === "unavailable") {
    conflicts.push({ type: "unavailable", detail: "Marked themselves unavailable at this period" });
  }

  return conflicts;
}

export function conflictSummary(conflicts: Conflict[]): string {
  return conflicts.map((c) => c.detail).join("; ");
}