import { describe, it, expect, beforeAll } from "vitest";
import { initDb, request, login, authHeaders, type SeedIds } from "./helpers";
import { addDays, todayISO } from "../src/lib/dates";

describe("absences", () => {
  let adminToken: string;
  let teacherToken: string;
  let ids: SeedIds;

  beforeAll(async () => {
    ids = await initDb();
    adminToken = await login("admin@cshs.edu", "adminpass1");
    teacherToken = await login("teacher.a@cshs.edu", "teacherpass1");
  });

  const tomorrow = () => addDays(todayISO(), 1);

  it("teacher files a pending leave", async () => {
    const res = await request("/api/absences", {
      method: "POST",
      headers: authHeaders(teacherToken),
      body: { date: tomorrow(), period: 1, reason: "Sick" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ids.length).toBe(1);
    expect(body.duplicates).toEqual([]);
  });

  it("teacher cannot file leave for another teacher", async () => {
    const res = await request("/api/absences", {
      method: "POST",
      headers: authHeaders(teacherToken),
      body: { teacher_id: ids.teacherB, date: tomorrow(), period: 2, reason: "x" },
    });
    expect(res.status).toBe(403);
  });

  it("filing same period twice is rejected as duplicate", async () => {
    const res = await request("/api/absences", {
      method: "POST",
      headers: authHeaders(teacherToken),
      body: { date: tomorrow(), period: 1, reason: "again" },
    });
    expect(res.status).toBe(409);
  });

  it("teacher sees own leaves only", async () => {
    const res = await request("/api/absences", { headers: authHeaders(teacherToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const a of body.absences) {
      expect(a.teacher_id).toBe(ids.teacherA);
    }
  });

  it("admin sees all leaves", async () => {
    const res = await request("/api/absences", { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.absences.length).toBeGreaterThan(0);
  });

  it("invalid date returns 400", async () => {
    const res = await request("/api/absences", {
      method: "POST",
      headers: authHeaders(teacherToken),
      body: { date: "not-a-date", period: 1 },
    });
    expect(res.status).toBe(400);
  });

  it("admin can approve a pending leave -> generates recommendations", async () => {
    // file a fresh pending absence as teacher B
    const created = await request("/api/absences", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherB, date: tomorrow(), period: 3, reason: "Seminar" },
    });
    expect(created.status).toBe(201);
    const { ids: createdIds } = await created.json();
    const absenceId = createdIds[0];

    // teacher B files it as pending? admin default is approved, so re-file pending:
    // Instead: create via teacher C's token then approve.
    const tC = await login("teacher.c@cshs.edu", "teacherpass1");
    const pend = await request("/api/absences", {
      method: "POST",
      headers: authHeaders(tC),
      body: { date: addDays(todayISO(), 2), period: 4, reason: "Medical" },
    });
    expect(pend.status).toBe(201);
    const { ids: pendIds } = await pend.json();
    const pendId = pendIds[0];

    const listBefore = await request("/api/absences", { headers: authHeaders(adminToken) });
    const beforeBody = await listBefore.json();
    const row = beforeBody.absences.find((a: any) => a.id === pendId);
    expect(row.status).toBe("pending");

    const approve = await request(`/api/absences/${pendId}/status`, {
      method: "PUT",
      headers: authHeaders(adminToken),
      body: { status: "approved" },
    });
    expect(approve.status).toBe(200);

    const listAfter = await request("/api/absences", { headers: authHeaders(adminToken) });
    const afterBody = await listAfter.json();
    const rowAfter = afterBody.absences.find((a: any) => a.id === pendId);
    expect(rowAfter.status).toBe("approved");

    // recommendations should exist
    const relief = await request(`/api/relief?absence_id=${pendId}`, { headers: authHeaders(adminToken) });
    const reliefBody = await relief.json();
    expect(reliefBody.assignments.length).toBeGreaterThan(0);
    expect(reliefBody.assignments.every((r: any) => r.status === "recommended")).toBe(true);
  });

  it("admin declining a pending leave returns declined", async () => {
    const tB = await login("teacher.b@cshs.edu", "teacherpass1");
    const created = await request("/api/absences", {
      method: "POST",
      headers: authHeaders(tB),
      body: { date: addDays(todayISO(), 3), period: 2, reason: "Personal" },
    });
    const { ids: createdIds } = await created.json();
    const decline = await request(`/api/absences/${createdIds[0]}/status`, {
      method: "PUT",
      headers: authHeaders(adminToken),
      body: { status: "declined" },
    });
    expect(decline.status).toBe(200);

    const list = await request("/api/absences", { headers: authHeaders(adminToken) });
    const body = await list.json();
    const row = body.absences.find((a: any) => a.id === createdIds[0]);
    expect(row.status).toBe("declined");
  });

  it("multi-period filing returns multiple ids", async () => {
    const res = await request("/api/absences", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherA, date: addDays(todayISO(), 4), periods: [5, 6], reason: "Workshop" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ids.length).toBe(2);
  });
});