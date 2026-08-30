import { describe, it, expect, beforeAll } from "vitest";
import { initDb, request, login, authHeaders } from "./helpers";

describe("smoke: harness boots", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("health endpoint responds", async () => {
    const res = await request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("cshs-trace");
  });

  it("admin can login and fetch /me", async () => {
    const token = await login("admin@cshs.edu", "adminpass1");
    expect(token.length).toBeGreaterThan(0);
    const res = await request("/api/auth/me", { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe("admin@cshs.edu");
    expect(body.user.role).toBe("admin");
  });

  it("teacher can login", async () => {
    const token = await login("teacher.a@cshs.edu", "teacherpass1");
    expect(token.length).toBeGreaterThan(0);
    const res = await request("/api/auth/me", { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.role).toBe("teacher");
  });

  it("login with wrong password fails 401", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: { email: "admin@cshs.edu", password: "wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("unauthenticated request to /api/dashboard is 401", async () => {
    const res = await request("/api/dashboard");
    expect(res.status).toBe(401);
  });
});