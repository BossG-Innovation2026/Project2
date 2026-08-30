import { describe, it, expect, beforeAll } from "vitest";
import { initDb, request, login, authHeaders, type SeedIds } from "./helpers";

describe("teachers", () => {
  let adminToken: string;
  let teacherToken: string;
  let ids: SeedIds;

  beforeAll(async () => {
    ids = await initDb();
    adminToken = await login("admin@cshs.edu", "adminpass1");
    teacherToken = await login("teacher.a@cshs.edu", "teacherpass1");
  });

  it("lists all teachers", async () => {
    const res = await request("/api/teachers", { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teachers.length).toBe(3);
    const tA = body.teachers.find((t: any) => t.id === ids.teacherA);
    expect(tA.department).toBe("Math");
    expect(tA.subjects).toBe("Gen-Math");
    expect(tA.max_weekly_load).toBe(20);
  });

  it("GET single teacher", async () => {
    const res = await request(`/api/teachers/${ids.teacherA}`, { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teacher.id).toBe(ids.teacherA);
  });

  it("GET non-teacher id returns 404", async () => {
    const res = await request("/api/teachers/9999", { headers: authHeaders(adminToken) });
    expect(res.status).toBe(404);
  });

  it("admin creates a teacher", async () => {
    const res = await request("/api/teachers", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { name: "Teacher D", email: "teacher.d@cshs.edu", password: "pass12345", department: "PE", subjects: "PE", cluster: "B4", room: "401", max_weekly_load: 15 },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
  });

  it("duplicate email returns 409", async () => {
    const res = await request("/api/teachers", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { name: "Dup", email: "teacher.d@cshs.edu", password: "pass12345" },
    });
    expect(res.status).toBe(409);
  });

  it("short password returns 400", async () => {
    const res = await request("/api/teachers", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { name: "Short", email: "short@cshs.edu", password: "short" },
    });
    expect(res.status).toBe(400);
  });

  it("teacher cannot create teachers (admin only)", async () => {
    const res = await request("/api/teachers", {
      method: "POST",
      headers: authHeaders(teacherToken),
      body: { name: "X", email: "x@cshs.edu", password: "pass12345" },
    });
    expect(res.status).toBe(403);
  });

  it("admin updates a teacher", async () => {
    const res = await request(`/api/teachers/${ids.teacherA}`, {
      method: "PUT",
      headers: authHeaders(adminToken),
      body: { department: "Mathematics Dept", subjects: "Gen-Math, Statistics" },
    });
    expect(res.status).toBe(200);
    const get = await request(`/api/teachers/${ids.teacherA}`, { headers: authHeaders(adminToken) });
    const body = await get.json();
    expect(body.teacher.department).toBe("Mathematics Dept");
    expect(body.teacher.subjects).toBe("Gen-Math, Statistics");
  });

  it("admin deletes a teacher", async () => {
    const created = await request("/api/teachers", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { name: "Temp", email: "temp@cshs.edu", password: "pass12345" },
    });
    const { id } = await created.json();
    const res = await request(`/api/teachers/${id}`, { method: "DELETE", headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const get = await request(`/api/teachers/${id}`, { headers: authHeaders(adminToken) });
    expect(get.status).toBe(404);
  });
});