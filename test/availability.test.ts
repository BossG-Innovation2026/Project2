import { describe, it, expect, beforeAll } from "vitest";
import { initDb, request, login, authHeaders, weekdayDate, type SeedIds } from "./helpers";
import { addDays, todayISO, weekdayOf } from "../src/lib/dates";

describe("availability", () => {
  let adminToken: string;
  let teacherToken: string;
  let ids: SeedIds;

  beforeAll(async () => {
    ids = await initDb();
    adminToken = await login("admin@cshs.edu", "adminpass1");
    teacherToken = await login("teacher.a@cshs.edu", "teacherpass1");
  });

  it("teacher sets own availability for a date/period", async () => {
    const day = addDays(todayISO(), 1);
    const res = await request("/api/availability", {
      method: "POST",
      headers: authHeaders(teacherToken),
      body: { date: day, period: 1, status: "unavailable" },
    });
    expect(res.status).toBe(200);

    const get = await request(`/api/availability?date=${day}&teacher_id=${ids.teacherA}`, {
      headers: authHeaders(teacherToken),
    });
    expect(get.status).toBe(200);
    const body = await get.json();
    const cell = body.availability.find((a: any) => a.period === 1);
    expect(cell).toBeDefined();
    expect(cell.status).toBe("unavailable");
  });

  it("teacher cannot set another teacher's availability", async () => {
    const day = addDays(todayISO(), 2);
    const res = await request("/api/availability", {
      method: "POST",
      headers: authHeaders(teacherToken),
      body: { teacher_id: ids.teacherB, date: day, period: 1, status: "unavailable" },
    });
    expect(res.status).toBe(403);
  });

  it("admin can set any teacher's availability", async () => {
    const day = addDays(todayISO(), 3);
    const res = await request("/api/availability", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherB, date: day, period: 2, status: "available" },
    });
    expect(res.status).toBe(200);
  });

  it("invalid status returns 400", async () => {
    const day = addDays(todayISO(), 4);
    const res = await request("/api/availability", {
      method: "POST",
      headers: authHeaders(teacherToken),
      body: { date: day, period: 1, status: "maybe" },
    });
    expect(res.status).toBe(400);
  });

  it("setting availability on a scheduled class slot is locked (409)", async () => {
    const day = weekdayDate(5);
    const wd = weekdayOf(day);
    // give teacher A a class at that slot
    await request("/api/schedules", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherA, weekday: wd, period: 3, subject: "Math", class_name: "G10-M" },
    });
    const res = await request("/api/availability", {
      method: "POST",
      headers: authHeaders(teacherToken),
      body: { date: day, period: 3, status: "unavailable" },
    });
    expect(res.status).toBe(409);
  });

  it("bulk set availability for a range", async () => {
    const from = addDays(todayISO(), 6);
    const to = addDays(todayISO(), 7);
    const res = await request("/api/availability/bulk", {
      method: "POST",
      headers: authHeaders(teacherToken),
      body: { from, to, periods: { "1": "unavailable", "2": "available" } },
    });
    expect(res.status).toBe(200);

    const get = await request(`/api/availability?from=${from}&to=${to}&teacher_id=${ids.teacherA}`, {
      headers: authHeaders(teacherToken),
    });
    const body = await get.json();
    const p1 = body.availability.filter((a: any) => a.period === 1);
    expect(p1.length).toBe(2); // one per day in the 2-day range
    expect(p1.every((a: any) => a.status === "unavailable")).toBe(true);
  });

  it("bulk set with invalid range returns 400", async () => {
    const res = await request("/api/availability/bulk", {
      method: "POST",
      headers: authHeaders(teacherToken),
      body: { from: "2026-12-31", to: "2026-01-01", periods: { "1": "available" } },
    });
    expect(res.status).toBe(400);
  });

  it("coverage endpoint returns matrix with correct statuses", async () => {
    const from = addDays(todayISO(), 6);
    const to = addDays(todayISO(), 7);
    const res = await request(`/api/availability/coverage?from=${from}&to=${to}`, {
      headers: authHeaders(adminToken),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period_count).toBe(8);
    expect(body.teachers.length).toBe(3);
    expect(body.cells.length).toBe(2 * 8 * 3); // days x periods x teachers

    // teacher A was bulk-set unavailable at period 1 on both days
    const tA = body.cells.filter((c: any) => c.teacher_id === ids.teacherA && c.period === 1);
    expect(tA.every((c: any) => c.status === "unavailable")).toBe(true);
  });

  it("coverage endpoint requires valid range", async () => {
    const res = await request("/api/availability/coverage?from=bad&to=worse", {
      headers: authHeaders(adminToken),
    });
    expect(res.status).toBe(400);
  });

  it("coverage reflects approved absence as absent", async () => {
    const day = addDays(todayISO(), 8);
    // admin creates approved absence for teacher C
    await request("/api/absences", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherC, date: day, period: 1, reason: "Sick" },
    });
    const res = await request(`/api/availability/coverage?from=${day}&to=${day}`, {
      headers: authHeaders(adminToken),
    });
    const body = await res.json();
    const cell = body.cells.find((c: any) => c.teacher_id === ids.teacherC && c.period === 1);
    expect(cell.status).toBe("absent");
  });
});