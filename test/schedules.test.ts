import { describe, it, expect, beforeAll } from "vitest";
import { initDb, request, login, authHeaders, type SeedIds } from "./helpers";

describe("schedules", () => {
  let adminToken: string;
  let ids: SeedIds;

  beforeAll(async () => {
    ids = await initDb();
    adminToken = await login("admin@cshs.edu", "adminpass1");
  });

  it("GET /api/schedules returns empty list initially", async () => {
    const res = await request("/api/schedules", { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schedules).toEqual([]);
    expect(body.period_count).toBe(8);
  });

  it("teacher cannot access schedules (admin only)", async () => {
    const t = await login("teacher.a@cshs.edu", "teacherpass1");
    const res = await request("/api/schedules", { headers: authHeaders(t) });
    expect(res.status).toBe(403);
  });

  it("POST a schedule entry", async () => {
    const res = await request("/api/schedules", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherA, weekday: 0, period: 1, subject: "Math", class_name: "G10-A" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
  });

  it("POST duplicate slot returns 409", async () => {
    const res = await request("/api/schedules", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherA, weekday: 0, period: 1, subject: "Math", class_name: "G10-A" },
    });
    expect(res.status).toBe(409);
  });

  it("POST weekday 5+ (weekend) returns 400", async () => {
    const res = await request("/api/schedules", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherA, weekday: 6, period: 1, subject: "x", class_name: "x" },
    });
    expect(res.status).toBe(400);
  });

  it("GET schedules filters by teacher_id", async () => {
    await request("/api/schedules", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherB, weekday: 1, period: 2, subject: "Science", class_name: "G9-B" },
    });
    const res = await request(`/api/schedules?teacher_id=${ids.teacherB}`, { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schedules.length).toBe(1);
    expect(body.schedules[0].teacher_id).toBe(ids.teacherB);
  });

  it("PUT updates schedule entry", async () => {
    const created = await request("/api/schedules", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherC, weekday: 2, period: 3, subject: "History", class_name: "G11-C" },
    });
    const { id } = await created.json();
    const res = await request(`/api/schedules/${id}`, {
      method: "PUT",
      headers: authHeaders(adminToken),
      body: { subject: "World History", class_name: "G11-H" },
    });
    expect(res.status).toBe(200);
  });

  it("DELETE removes schedule entry", async () => {
    const created = await request("/api/schedules", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherB, weekday: 3, period: 4, subject: "PE", class_name: "G12-PE" },
    });
    const { id } = await created.json();
    const res = await request(`/api/schedules/${id}`, { method: "DELETE", headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const get = await request("/api/schedules", { headers: authHeaders(adminToken) });
    const body = await get.json();
    expect(body.schedules.find((s: any) => s.id === id)).toBeUndefined();
  });

  it("replace-all atomically replaces all entries", async () => {
    const entries = [
      { teacher_id: ids.teacherA, weekday: 0, period: 1, subject: "Math", class_name: "G10-A" },
      { teacher_id: ids.teacherB, weekday: 1, period: 2, subject: "Science", class_name: "G9-B" },
      { teacher_id: ids.teacherC, weekday: 2, period: 3, subject: "History", class_name: "G11-C" },
    ];
    const res = await request("/api/schedules/replace-all", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { entries },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replaced).toBe(3);

    const get = await request("/api/schedules", { headers: authHeaders(adminToken) });
    const getBody = await get.json();
    expect(getBody.schedules.length).toBe(3);
  });

  it("replace-all with empty entries returns 400", async () => {
    const res = await request("/api/schedules/replace-all", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { entries: [] },
    });
    expect(res.status).toBe(400);
  });

  it("replace-all rejects double-booked teacher", async () => {
    const res = await request("/api/schedules/replace-all", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { entries: [
        { teacher_id: ids.teacherA, weekday: 0, period: 1, subject: "A", class_name: "C1" },
        { teacher_id: ids.teacherA, weekday: 0, period: 1, subject: "B", class_name: "C2" },
      ]},
    });
    expect(res.status).toBe(400);
  });
});