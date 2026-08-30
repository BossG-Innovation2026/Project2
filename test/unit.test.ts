import { describe, it, expect } from "vitest";
import { todayISO, addDays, weekdayOf, startOfWeek, endOfWeek, isValidDate } from "../src/lib/dates";
import { conflictSummary } from "../src/services/conflicts";

describe("dates", () => {
  it("todayISO returns YYYY-MM-DD format", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("addDays adds correctly", () => {
    expect(addDays("2026-08-01", 1)).toBe("2026-08-02");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("weekdayOf returns 0=Monday through 6=Sunday", () => {
    // 2026-08-31 is a Monday
    expect(weekdayOf("2026-08-31")).toBe(0);
    // 2026-09-06 is a Sunday
    expect(weekdayOf("2026-09-06")).toBe(6);
    // 2026-09-01 is Tuesday
    expect(weekdayOf("2026-09-01")).toBe(1);
  });

  it("startOfWeek returns Sunday", () => {
    // 2026-09-05 is Saturday, week starts Sunday 2026-08-30
    expect(startOfWeek("2026-09-05")).toBe("2026-08-30");
    // 2026-08-31 is Monday, week starts Sunday 2026-08-30
    expect(startOfWeek("2026-08-31")).toBe("2026-08-30");
  });

  it("endOfWeek returns Saturday", () => {
    expect(endOfWeek("2026-09-01")).toBe("2026-09-05");
    expect(endOfWeek("2026-08-31")).toBe("2026-09-05");
  });

  it("isValidDate validates correctly", () => {
    expect(isValidDate("2026-08-01")).toBe(true);
    expect(isValidDate("not-a-date")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-00-01")).toBe(false);
    expect(isValidDate("")).toBe(false);
  });
});

describe("conflictSummary", () => {
  it("joins conflict details", () => {
    const result = conflictSummary([
      { type: "schedule", detail: "Has Math at this period" },
      { type: "unavailable", detail: "Marked unavailable" },
    ]);
    expect(result).toBe("Has Math at this period; Marked unavailable");
  });

  it("returns empty string for no conflicts", () => {
    expect(conflictSummary([])).toBe("");
  });
});

describe("generateTimetable", () => {
  it("returns empty result for no classes", async () => {
    const { generateTimetable } = await import("../client/src/lib/generator");
    const result = generateTimetable({
      classes: [],
      clusters: {},
      curriculum: {},
      teachers: [],
      periodCount: 8,
    });
    expect(result.entries).toEqual([]);
    expect(result.unplaced).toEqual([]);
  });

  it("generates a simple timetable for one class", async () => {
    const { generateTimetable } = await import("../client/src/lib/generator");
    const result = generateTimetable({
      classes: ["G10-A"],
      clusters: {},
      curriculum: { "G10-A": { "Gen-Math": 5 } },
      teachers: [
        { id: 1, name: "T1", subjects: "Gen-Math", active: 1, max_weekly_load: 25 } as any,
      ],
      periodCount: 8,
    });
    expect(result.entries.length).toBe(5); // 5 sessions
    expect(result.unplaced).toEqual([]);
    // All sessions should be for the same teacher
    expect(result.entries.every((e: any) => e.teacher_id === 1)).toBe(true);
    // All should be Gen-Math
    expect(result.entries.every((e: any) => e.subject === "Gen-Math")).toBe(true);
    // Weekdays 0-4 (Mon-Fri)
    expect(new Set(result.entries.map((e: any) => e.weekday)).size).toBe(5);
  });

  it("returns unplaced when no specialist available", async () => {
    const { generateTimetable } = await import("../client/src/lib/generator");
    const result = generateTimetable({
      classes: ["G10-A"],
      clusters: {},
      curriculum: { "G10-A": { "Gen-Math": 5 } },
      teachers: [
        { id: 1, name: "T1", subjects: "History", active: 1, max_weekly_load: 25 } as any,
      ],
      periodCount: 8,
    });
    expect(result.entries.length).toBe(0);
    expect(result.unplaced.length).toBeGreaterThan(0);
    expect(result.unplaced[0].reason).toContain("specializes");
  });

  it("capped at 5 sessions per subject", async () => {
    const { generateTimetable } = await import("../client/src/lib/generator");
    const result = generateTimetable({
      classes: ["G10-A"],
      clusters: {},
      curriculum: { "G10-A": { "Gen-Math": 10 } }, // 10 requested, cap at 5
      teachers: [
        { id: 1, name: "T1", subjects: "Gen-Math", active: 1, max_weekly_load: 25 } as any,
      ],
      periodCount: 8,
    });
    expect(result.entries.length).toBe(5);
  });
});