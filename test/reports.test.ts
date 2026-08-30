import { describe, it, expect, beforeAll } from "vitest";
import { initDb, request, login, authHeaders, type SeedIds } from "./helpers";
import { addDays, todayISO } from "../src/lib/dates";

describe("reports", () => {
  let adminToken: string;
  let teacherToken: string;
  let ids: SeedIds;

  beforeAll(async () => {
    ids = await initDb();
    adminToken = await login("admin@cshs.edu", "adminpass1");
    teacherToken = await login("teacher.a@cshs.edu", "teacherpass1");
  });

  it("summary endpoint returns stats", async () => {
    const res = await request("/api/reports/summary", { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teachers).toBe(3);
    expect(typeof body.pending_absences).toBe("number");
    expect(typeof body.absences_this_week).toBe("number");
  });

  it("workload endpoint returns per-teacher rows", async () => {
    const res = await request("/api/reports/workload", { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workload.length).toBe(3);
    const tA = body.workload.find((w: any) => w.teacher_id === ids.teacherA);
    expect(tA.max_weekly_load).toBe(20);
    expect(typeof tA.utilization).toBe("number");
  });

  it("coverage endpoint returns days + coverage rate", async () => {
    const from = addDays(todayISO(), 0);
    const to = addDays(todayISO(), 6);
    const res = await request(`/api/reports/coverage?from=${from}&to=${to}`, { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days.length).toBe(7);
    expect(typeof body.coverage_rate).toBe("number");
  });

  it("coverage rejects invalid range", async () => {
    const res = await request("/api/reports/coverage?from=bad&to=worse", { headers: authHeaders(adminToken) });
    expect(res.status).toBe(400);
  });

  it("my-summary returns own stats for teacher", async () => {
    const res = await request("/api/reports/my-summary", { headers: authHeaders(teacherToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.max_weekly_load).toBe(20);
    expect(typeof body.utilization).toBe("number");
  });

  it("my-monthly-leaves returns month buckets", async () => {
    const res = await request("/api/reports/my-monthly-leaves", { headers: authHeaders(teacherToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.months)).toBe(true);
  });

  it("my-relief-by-subject returns list", async () => {
    const res = await request("/api/reports/my-relief-by-subject", { headers: authHeaders(teacherToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.subjects)).toBe(true);
  });

  it("history endpoint returns rows", async () => {
    const res = await request("/api/reports/history", { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.history)).toBe(true);
  });

  it("absences-by-reason returns grouped reasons", async () => {
    const res = await request("/api/reports/absences-by-reason", { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.reasons)).toBe(true);
  });

  it("csv export returns text/csv", async () => {
    const res = await request("/api/reports/export.csv", { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toContain("reliever");
  });

  it("dashboard endpoint returns full payload", async () => {
    const res = await request("/api/dashboard", { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.role).toBe("admin");
    expect(typeof body.period_count).toBe("number");
    expect(Array.isArray(body.my_absences)).toBe(true);
    expect(Array.isBody ? true : Array.isArray(body.upcoming_absences)).toBe(true);
  });
});