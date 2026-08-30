import { describe, it, expect, beforeAll } from "vitest";
import { initDb, request, login, authHeaders } from "./helpers";

describe("settings", () => {
  let adminToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    await initDb();
    adminToken = await login("admin@cshs.edu", "adminpass1");
    teacherToken = await login("teacher.a@cshs.edu", "teacherpass1");
  });

  it("public settings are accessible without auth", async () => {
    const res = await request("/api/settings/public");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.system_name).toBe("CSHS TRACE");
    expect(body.subjects).toEqual([]);
    expect(body.has_logo).toBe(false);
  });

  it("GET settings requires auth", async () => {
    const res = await request("/api/settings");
    expect(res.status).toBe(401);
  });

  it("teacher cannot PUT settings (admin only)", async () => {
    const res = await request("/api/settings", {
      method: "PUT",
      headers: authHeaders(teacherToken),
      body: { system_name: "X" },
    });
    expect(res.status).toBe(403);
  });

  it("admin can update branding", async () => {
    const res = await request("/api/settings", {
      method: "PUT",
      headers: authHeaders(adminToken),
      body: { system_name: "CSHS TRACE Updated", system_tagline: "New Tagline" },
    });
    expect(res.status).toBe(200);
    const get = await request("/api/settings", { headers: authHeaders(adminToken) });
    const body = await get.json();
    expect(body.system_name).toBe("CSHS TRACE Updated");
  });

  it("admin can update subjects list", async () => {
    const res = await request("/api/settings", {
      method: "PUT",
      headers: authHeaders(adminToken),
      body: { subjects: [{ code: "MATH", name: "Mathematics", description: "Algebra & geometry" }] },
    });
    expect(res.status).toBe(200);
  });

  it("admin can update classes list", async () => {
    const res = await request("/api/settings", {
      method: "PUT",
      headers: authHeaders(adminToken),
      body: { classes: [
        { name: "G10-A", gradeLevel: "10", cluster: "B1", room: "101" },
        { name: "G9-B", gradeLevel: "9", cluster: "B2", room: "201" },
      ]},
    });
    expect(res.status).toBe(200);
    const get = await request("/api/settings", { headers: authHeaders(adminToken) });
    const body = await get.json();
    expect(body.classes.length).toBe(2);
  });

  it("duplicate class names rejected", async () => {
    const res = await request("/api/settings", {
      method: "PUT",
      headers: authHeaders(adminToken),
      body: { classes: [
        { name: "G10-A", gradeLevel: "10", cluster: "B1", room: "101" },
        { name: "G10-A", gradeLevel: "10", cluster: "B2", room: "102" },
      ]},
    });
    expect(res.status).toBe(400);
  });

  it("admin can update period count + names", async () => {
    const res = await request("/api/settings", {
      method: "PUT",
      headers: authHeaders(adminToken),
      body: { period_count: 6, period_names: ["P1","P2","P3","P4","P5","P6"] },
    });
    expect(res.status).toBe(200);
    const periods = await request("/api/periods", { headers: authHeaders(adminToken) });
    const pBody = await periods.json();
    expect(pBody.period_count).toBe(6);
    // reset back to 8
    await request("/api/settings", {
      method: "PUT",
      headers: authHeaders(adminToken),
      body: { period_count: 8, period_names: ["Period 1","Period 2","Period 3","Period 4","Period 5","Period 6","Period 7","Period 8"] },
    });
  });

  it("overlong system name rejected", async () => {
    const res = await request("/api/settings", {
      method: "PUT",
      headers: authHeaders(adminToken),
      body: { system_name: "X".repeat(100) },
    });
    expect(res.status).toBe(400);
  });
});