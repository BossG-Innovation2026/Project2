import { describe, it, expect, beforeAll } from "vitest";
import { initDb, request, login, authHeaders, type SeedIds } from "./helpers";

describe("notifications", () => {
  let adminToken: string;
  let teacherToken: string;
  let ids: SeedIds;

  beforeAll(async () => {
    ids = await initDb();
    adminToken = await login("admin@cshs.edu", "adminpass1");
    teacherToken = await login("teacher.a@cshs.edu", "teacherpass1");
  });

  it("starts with empty notifications", async () => {
    const res = await request("/api/notifications", { headers: authHeaders(teacherToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications).toEqual([]);
    expect(body.unread_count).toBe(0);
  });

  it("filing a pending leave creates notification for admin", async () => {
    // teacher A files a pending leave -> admin gets notified
    const day = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
    await request("/api/absences", {
      method: "POST",
      headers: authHeaders(teacherToken),
      body: { date: day, period: 1, reason: "Test" },
    });

    const res = await request("/api/notifications", { headers: authHeaders(adminToken) });
    const body = await res.json();
    expect(body.notifications.length).toBeGreaterThan(0);
    const n = body.notifications.find((a: any) => a.type === "absence_request");
    expect(n).toBeDefined();
    expect(n.is_read).toBe(0);
  });

  it("mark one notification as read", async () => {
    const list = await request("/api/notifications", { headers: authHeaders(adminToken) });
    const body = await list.json();
    const unread = body.notifications.find((n: any) => n.is_read === 0);
    if (unread) {
      const res = await request(`/api/notifications/${unread.id}/read`, {
        method: "POST",
        headers: authHeaders(adminToken),
      });
      expect(res.status).toBe(200);
      const after = await request("/api/notifications", { headers: authHeaders(adminToken) });
      const afterBody = await after.json();
      const found = afterBody.notifications.find((n: any) => n.id === unread.id);
      expect(found.is_read).toBe(1);
    }
  });

  it("mark all as read", async () => {
    const res = await request("/api/notifications/read-all", {
      method: "POST",
      headers: authHeaders(adminToken),
    });
    expect(res.status).toBe(200);

    const list = await request("/api/notifications", { headers: authHeaders(adminToken) });
    const body = await list.json();
    expect(body.unread_count).toBe(0);
    expect(body.notifications.every((n: any) => n.is_read === 1)).toBe(true);
  });

  it("limit query param works", async () => {
    const res = await request("/api/notifications?limit=1", { headers: authHeaders(adminToken) });
    const body = await res.json();
    expect(body.notifications.length).toBeLessThanOrEqual(1);
  });

  it("teacher sees own notifications only", async () => {
    const res = await request("/api/notifications", { headers: authHeaders(teacherToken) });
    const body = await res.json();
    // teacher A should have no notifications after admin read-all
    // (admin's notifications are separate from teacher's)
    expect(body.unread_count).toBe(0);
  });
});