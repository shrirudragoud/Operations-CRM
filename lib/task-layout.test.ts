import { describe, expect, it } from "vitest";
import {
  addDays, barColumns, calendarMonth, daysBetween, groupByPerson, layoutWindow, mondayOf, monthWeeks, shiftMonth, taskSpan,
  tasksByDay, timelineDays, timelineStart,
} from "./task-layout";

describe("date math", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-03-01", "2026-03-10")).toBe(9);
    expect(daysBetween("2026-03-10", "2026-03-01")).toBe(-9);
  });
  it("finds the Monday", () => {
    expect(mondayOf("2026-03-04")).toBe("2026-03-02");
    expect(mondayOf("2026-03-02")).toBe("2026-03-02");
    expect(mondayOf("2026-03-08")).toBe("2026-03-02");
  });
  it("shifts months", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("calendar", () => {
  it("falls back to this month on junk", () => {
    expect(calendarMonth("", "2026-03-15")).toBe("2026-03");
    expect(calendarMonth("2026-13", "2026-03-15")).toBe("2026-03");
    expect(calendarMonth("2026-07-09", "2026-03-15")).toBe("2026-07");
  });
  it("builds Monday-first weeks that cover the month", () => {
    const weeks = monthWeeks("2026-03");
    expect(weeks[0]?.[0]).toBe("2026-02-23");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat()).toContain("2026-03-31");
    expect(weeks[weeks.length - 1]?.[6]).toBe("2026-04-05");
  });
});

describe("spans", () => {
  it("uses start to deadline, or the single date", () => {
    expect(taskSpan({ start_date: "2026-03-02", due_date: "2026-03-05" })).toEqual({ start: "2026-03-02", end: "2026-03-05" });
    expect(taskSpan({ start_date: null, due_date: "2026-03-05" })).toEqual({ start: "2026-03-05", end: "2026-03-05" });
    expect(taskSpan({ start_date: "2026-03-05", due_date: null })).toEqual({ start: "2026-03-05", end: "2026-03-05" });
    expect(taskSpan({ start_date: null, due_date: null })).toBeNull();
    expect(taskSpan({ start_date: "2026-03-09", due_date: "2026-03-05" })).toEqual({ start: "2026-03-05", end: "2026-03-05" });
  });
  it("puts a task on every day it covers, clipped to the days shown", () => {
    const t = { start_date: "2026-03-02", due_date: "2026-03-04" };
    const map = tasksByDay([t], ["2026-03-03", "2026-03-04", "2026-03-05"]);
    expect([...map.keys()]).toEqual(["2026-03-03", "2026-03-04"]);
    expect(tasksByDay([{ start_date: null, due_date: null }], ["2026-03-03"]).size).toBe(0);
  });
});

describe("timeline", () => {
  it("starts on a Monday and covers 14 days", () => {
    expect(timelineStart("2026-03-04", "2026-01-01")).toBe("2026-03-02");
    expect(timelineStart("", "2026-03-04")).toBe("2026-03-02");
    expect(timelineStart("2026-03", "2026-03-04")).toBe("2026-03-02");
    const days = timelineDays("2026-03-02");
    expect(days).toHaveLength(14);
    expect(days[13]).toBe("2026-03-15");
  });
  it("places and clips bars", () => {
    expect(barColumns({ start_date: "2026-03-03", due_date: "2026-03-04" }, "2026-03-02")).toEqual({ col: 2, end: 4, clippedStart: false, clippedEnd: false });
    expect(barColumns({ start_date: "2026-02-20", due_date: "2026-03-03" }, "2026-03-02")).toMatchObject({ col: 1, end: 3, clippedStart: true });
    expect(barColumns({ start_date: "2026-03-10", due_date: "2026-04-01" }, "2026-03-02")).toMatchObject({ col: 9, end: 15, clippedEnd: true });
    expect(barColumns({ start_date: null, due_date: "2026-04-01" }, "2026-03-02")).toBeNull();
  });
  it("asks the database for the visible window only", () => {
    expect(layoutWindow("board", "", "2026-03-04")).toBeNull();
    expect(layoutWindow("timeline", "", "2026-03-04")).toEqual({ from: "2026-03-02", to: "2026-03-15" });
    expect(layoutWindow("calendar", "2026-03", "2026-03-04")).toEqual({ from: "2026-02-23", to: "2026-04-05" });
  });
  it("groups by person with unassigned last", () => {
    const g = groupByPerson([
      { assignee_id: null, assignee: null },
      { assignee_id: "b", assignee: { full_name: "Zed" } },
      { assignee_id: "a", assignee: { full_name: "Asha" } },
      { assignee_id: "a", assignee: { full_name: "Asha" } },
    ]);
    expect(g.map((x) => x.person.name)).toEqual(["Asha", "Zed", "Unassigned"]);
    expect(g[0]?.tasks).toHaveLength(2);
  });
});
