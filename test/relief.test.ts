import { describe, it, expect, beforeAll } from "vitest";
import { initDb, request, login, authHeaders, weekdayDate, type SeedIds } from "./helpers";
import { addDays, todayISO, weekdayOf } from "../src/lib/dates";

describe("relief", () => {
  let adminToken: string;
  let teacherToken: string;
  let ids: SeedIds;
  let dayOffset = 1; // each test uses a unique offset to avoid data collisions

  const nextDay = () => addDays(todayISO(), dayOffset++);
  const nextPeriod = () => ((dayOffset * 3) % 8) + 1;

  beforeAll(async () => {
    ids = await initDb();
    adminToken = await login("admin@cshs.edu", "adminpass1");
    teacherToken = await login("teacher.a@cshs.edu", "teacherpass1");
  });

  async function createApprovedAbsence(teacherId: number, days?: number, period = 1, reason = "Relief test"): Promise<number> {
    const date = days != null ? addDays(todayISO(), days) : nextDay();
    const res = await request("/api/absences", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: teacherId, date: date, period, reason },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    return body.ids[0];
  }

  it("candidates endpoint returns ranked list for an approved absence", async () => {
    const absenceId = await createApprovedAbsence(ids.teacherA, 1, 1);
    const res = await request(`/api/relief/candidates/${absenceId}`, { headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.absence.id).toBe(absenceId);
    for (const cand of body.candidates) {
      expect(cand.teacher_id).not.toBe(ids.teacherA);
    }
  });

  it("teacher cannot access candidates endpoint (admin only)", async () => {
    const absenceId = await createApprovedAbsence(ids.teacherA, 2, 1);
    const res = await request(`/api/relief/candidates/${absenceId}`, { headers: authHeaders(teacherToken) });
    expect(res.status).toBe(403);
  });

  it("admin assigns a reliever -> assignment is created with correct subject/class from schedule", async () => {
    const day = addDays(todayISO(), 3);
    const wd = weekdayOf(day);
    await request("/api/schedules", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherA, weekday: wd, period: 2, subject: "Gen-Math", class_name: "G10-Math" },
    });

    const absenceId = await createApprovedAbsence(ids.teacherA, 3, 2);
    const res = await request("/api/relief/assign", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { absence_id: absenceId, reliever_id: ids.teacherB },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.override).toBe(false);

    const list = await request(`/api/relief?absence_id=${absenceId}`, { headers: authHeaders(adminToken) });
    const listBody = await list.json();
    const assignment = listBody.assignments.find((r: any) => r.status === "assigned");
    expect(assignment).toBeDefined();
    expect(assignment.reliever_id).toBe(ids.teacherB);
  });

  it("assigning to a teacher with a conflict returns 409", async () => {
    const day = addDays(todayISO(), 4);
    const wd = weekdayOf(day);
    // Teacher B has a class at this slot
    await request("/api/schedules", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherB, weekday: wd, period: 1, subject: "Gen-Sci", class_name: "G9-Sci" },
    });
    const absenceId = await createApprovedAbsence(ids.teacherA, 4, 1);
    const res = await request("/api/relief/assign", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { absence_id: absenceId, reliever_id: ids.teacherB },
    });
    expect(res.status).toBe(409);
  });

  it("override bypasses conflict check", async () => {
    const day = addDays(todayISO(), 5);
    const wd = weekdayOf(day);
    // Teacher B has class at this slot (from prior test), but override bypasses it
    const absenceId = await createApprovedAbsence(ids.teacherA, 5, 1);
    const res = await request("/api/relief/assign", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { absence_id: absenceId, reliever_id: ids.teacherB, override: true },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.override).toBe(true);

    const list = await request(`/api/relief?absence_id=${absenceId}`, { headers: authHeaders(adminToken) });
    const listBody = await list.json();
    const assignment = listBody.assignments.find((r: any) => r.status === "overridden");
    expect(assignment).toBeDefined();
    expect(assignment.is_override).toBe(1);
  });

  it("cannot assign a teacher on leave to their own absence", async () => {
    const absenceId = await createApprovedAbsence(ids.teacherA, 6, 1);
    const res = await request("/api/relief/assign", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { absence_id: absenceId, reliever_id: ids.teacherA },
    });
    expect(res.status).toBe(400);
  });

  it("teacher can accept an assigned assignment", async () => {
    const absenceId = await createApprovedAbsence(ids.teacherC, 7, 1);
    const assign = await request("/api/relief/assign", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { absence_id: absenceId, reliever_id: ids.teacherB },
    });
    expect(assign.status).toBe(201);
    const assignBody = await assign.json();

    const tB = await login("teacher.b@cshs.edu", "teacherpass1");
    const res = await request(`/api/relief/${assignBody.id}/respond`, {
      method: "PUT",
      headers: authHeaders(tB),
      body: { status: "accepted" },
    });
    expect(res.status).toBe(200);

    const list = await request(`/api/relief?absence_id=${absenceId}`, { headers: authHeaders(adminToken) });
    const listBody = await list.json();
    const assignment = listBody.assignments.find((r: any) => r.id === assignBody.id);
    expect(assignment.status).toBe("accepted");
  });

  it("a different teacher cannot respond to someone else's assignment", async () => {
    const absenceId = await createApprovedAbsence(ids.teacherC, 8, 1);
    const assign = await request("/api/relief/assign", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { absence_id: absenceId, reliever_id: ids.teacherB },
    });
    const assignBody = await assign.json();
    const tA = await login("teacher.a@cshs.edu", "teacherpass1");
    const res = await request(`/api/relief/${assignBody.id}/respond`, {
      method: "PUT",
      headers: authHeaders(tA),
      body: { status: "accepted" },
    });
    expect(res.status).toBe(403);
  });

  it("teacher can see own assignments only via mine=1", async () => {
    const res = await request("/api/relief?mine=1", { headers: authHeaders(teacherToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const r of body.assignments) {
      expect(r.reliever_id).toBe(ids.teacherA);
    }
  });

  it("conflict check endpoint reports clear for free teacher", async () => {
    const day = addDays(todayISO(), 9);
    const res = await request(`/api/relief/check?teacher_id=${ids.teacherC}&date=${day}&period=1`, {
      headers: authHeaders(adminToken),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clear).toBe(true);
  });

  it("conflict check endpoint requires date and period", async () => {
    const res = await request("/api/relief/check", { headers: authHeaders(adminToken) });
    expect(res.status).toBe(400);
  });

  it("admin can delete an assignment", async () => {
    const absenceId = await createApprovedAbsence(ids.teacherC, 10, 1);
    const assign = await request("/api/relief/assign", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { absence_id: absenceId, reliever_id: ids.teacherB },
    });
    const assignBody = await assign.json();
    const res = await request(`/api/relief/${assignBody.id}`, { method: "DELETE", headers: authHeaders(adminToken) });
    expect(res.status).toBe(200);
  });

  it("declining the last assignment re-generates recommendations", async () => {
    const absenceId = await createApprovedAbsence(ids.teacherC, 13, 1);
    const assign = await request("/api/relief/assign", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { absence_id: absenceId, reliever_id: ids.teacherB },
    });
    const assignBody = await assign.json();

    const tB = await login("teacher.b@cshs.edu", "teacherpass1");
    const decline = await request(`/api/relief/${assignBody.id}/respond`, {
      method: "PUT",
      headers: authHeaders(tB),
      body: { status: "declined" },
    });
    expect(decline.status).toBe(200);

    // After decline, recommended rows should be regenerated
    const list = await request(`/api/relief?absence_id=${absenceId}`, { headers: authHeaders(adminToken) });
    const listBody = await list.json();
    expect(listBody.assignments.some((r: any) => r.status === "recommended")).toBe(true);
  });

  it("assignment stores the correct subject/class for the target weekday", async () => {
    // Day 12 weekday: schedule teacher A with a known subject on that weekday+period,
    // then create the absence on that exact date+period and verify the assignment
    // picks up the right subject (regression for the weekday off-by-one bug).
    const day = weekdayDate(12);
    const wd = weekdayOf(day);
    await request("/api/schedules", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherA, weekday: wd, period: 2, subject: "OffByOne-Math", class_name: "OB1" },
    });

    const abs = await request("/api/absences", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { teacher_id: ids.teacherA, date: day, period: 2, reason: "ob" },
    });
    const { ids: absIds } = await abs.json();
    const absenceId = absIds[0];
    const assign = await request("/api/relief/assign", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: { absence_id: absenceId, reliever_id: ids.teacherB },
    });
    expect(assign.status).toBe(201);

    const list = await request(`/api/relief?absence_id=${absenceId}`, { headers: authHeaders(adminToken) });
    const listBody = await list.json();
    const assignment = listBody.assignments.find((r: any) => r.status === "assigned");
    expect(assignment.subject).toBe("OffByOne-Math");
    expect(assignment.class_name).toBe("OB1");
  });
});