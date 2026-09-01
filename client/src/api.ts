export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (res.status === 401 && !path.startsWith("/api/auth/login")) {
    throw new ApiError(401, "Unauthorized");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
      if (data.error === "Conflict detected") {
        const err: unknown = data;
        (err as { conflicts?: unknown[] }).conflicts = data.conflicts;
      }
    } catch {
      /* ignore */
    }
    const err = new ApiError(res.status, msg);
    if (res.status === 409) {
      const data = await res.clone().json().catch(() => null);
      if (data?.conflicts) (err as unknown as { conflicts?: unknown[] }).conflicts = data.conflicts;
    }
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type PeriodStatus = "available" | "unavailable" | "class";
export type AbsenceStatus = "pending" | "approved" | "declined";
export type ReliefStatus = "recommended" | "assigned" | "accepted" | "declined" | "overridden";

export interface User {
  id: number;
  name: string;
  email: string;
  role: "admin" | "teacher";
}

export interface Teacher {
  id: number;
  name: string;
  email: string;
  role: string;
  active: number;
  department: string;
  subjects: string;
  cluster?: string;
  room?: string;
  max_weekly_load: number;
  notes: string;
  created_at: string;
}

export interface ScheduleRow {
  id: number;
  teacher_id: number;
  teacher_name: string;
  weekday: number;
  period: number;
  subject: string;
  class_name: string;
}

export interface Absence {
  id: number;
  teacher_id: number;
  teacher_name: string;
  date: string;
  period: number;
  reason: string;
  status: AbsenceStatus;
  requested_by: number;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
  reliever_names?: string | null;
}

export interface ReliefRow {
  id: number;
  absence_id: number;
  reliever_id: number;
  reliever_name: string;
  date: string;
  period: number;
  subject: string;
  class_name: string;
  status: ReliefStatus;
  is_override: number;
  created_by: number;
  created_at: string;
  updated_at: string | null;
  absent_teacher_id: number;
  absent_teacher_name: string;
}

export interface CoverageCell {
  date: string;
  weekday: number;
  period: number;
  teacher_id: number;
  teacher_name: string;
  department: string;
  status: "class" | "available" | "unavailable" | "absent";
  subject: string;
  class_name: string;
  absence_id: number | null;
  absence_status: string | null;
  absence_reason: string;
  assignment_id: number | null;
  assignment_status: string | null;
  is_override: number;
  reliever_name: string | null;
  absent_teacher_id: number | null;
}

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  message: string;
  link: string;
  is_read: number;
  created_at: string;
}

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

export interface MySummary {
  leaves_this_week: number;
  leaves_all_time: number;
  leaves_pending: number;
  relief_this_week: number;
  relief_all_time: number;
  scheduled_periods: number;
  max_weekly_load: number;
  total_load: number;
  utilization: number;
}

export interface MonthlyLeaves {
  months: { month: string; label: string; n: number }[];
}

export interface ReliefBySubject {
  subjects: { subject: string; n: number }[];
}

export interface MyWorkload {
  department: string;
  subjects: string;
  max_weekly_load: number;
  scheduled_periods: number;
  relief_this_week: number;
  relief_all_time: number;
  available: number;
}