import { describe, it, expect, beforeAll } from "vitest";
import { initDb, request, login, authHeaders } from "./helpers";

describe("auth", () => {
  let adminToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    await initDb();
    adminToken = await login("admin@cshs.edu", "adminpass1");
    teacherToken = await login("teacher.a@cshs.edu", "teacherpass1");
  });

  it("login with wrong email returns 401", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: { email: "nobody@cshs.edu", password: "x" },
    });
    expect(res.status).toBe(401);
  });

  it("logout clears session", async () => {
    const res = await request("/api/auth/logout", { method: "POST", headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const me = await request("/api/auth/me", { headers: authHeaders(adminToken) });
    expect(me.status).toBe(401);
    // Re-login for subsequent tests
    adminToken = await login("admin@cshs.edu", "adminpass1");
  });

  it("verify password works", async () => {
    const res = await request("/api/auth/verify", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { password: "adminpass1" },
    });
    expect(res.status).toBe(200);
  });

  it("verify password fails with wrong password", async () => {
    const res = await request("/api/auth/verify", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { password: "wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("change password works", async () => {
    const res = await request("/api/auth/change-password", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { current: "adminpass1", new_password: "newpass123" },
    });
    expect(res.status).toBe(200);
    // Revert
    await request("/api/auth/change-password", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { current: "newpass123", new_password: "adminpass1" },
    });
  });

  it("change password rejects short password", async () => {
    const res = await request("/api/auth/change-password", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { current: "adminpass1", new_password: "short" },
    });
    expect(res.status).toBe(400);
  });

  it("admin-only route blocks teacher", async () => {
    const res = await request("/api/teachers", { method: "POST", headers: authHeaders(teacherToken), body: {} });
    expect(res.status).toBe(403);
  });

  it("admin-only route allows admin", async () => {
    // POST /api/teachers requires admin
    const res = await request("/api/teachers", { method: "POST", headers: authHeaders(adminToken), body: { name: "Test", email: "new@cshs.edu", password: "pass12345" } });
    expect(res.status).toBe(201);
  });
});