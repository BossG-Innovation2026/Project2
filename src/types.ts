export interface AppEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;
}

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: "admin" | "teacher";
}

export type Variables = {
  user: SessionUser;
  sessionToken: string;
};

export interface AppContext {
  Bindings: AppEnv;
  Variables: Variables;
}

export type Role = "admin" | "teacher";

export const PERIOD_STATUSES = ["available", "unavailable", "class"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const ABSENCE_STATUSES = ["pending", "approved", "declined"] as const;
export type AbsenceStatus = (typeof ABSENCE_STATUSES)[number];

export const RELIEF_STATUSES = ["recommended", "assigned", "accepted", "declined", "overridden"] as const;
export type ReliefStatus = (typeof RELIEF_STATUSES)[number];