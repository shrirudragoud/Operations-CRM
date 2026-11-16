import { describe, expect, it } from "vitest";
import {
  allowedEventMoves, cancelEventSchema, completeEventSchema, dayOfEvent, endForDuration, eventDays, eventsByDay,
  eventTeamSchema, gridRange, isoToIstLocal, istLocalToIso, monthGrid, parseWorkshopParams, runSheetProgress,
  scheduleMissing, shiftMonth, updateEventSchema, workshopQuery,
} from "./event";

const ID = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-12-10T05:00:00Z");

describe("India time helpers", () => {
  it("reads a datetime-local value as India time", () => {
    expect(istLocalToIso("2026-12-01T09:30")).toBe("2026-12-01T04:00:00.000Z");
  });
  it("round-trips an instant to the datetime-local value", () => {
    expect(isoToIstLocal("2026-12-01T04:00:00.000Z")).toBe("2026-12-01T09:30");
    expect(isoToIstLocal("2026-12-01T20:00:00.000Z")).toBe("2026-12-02T01:30");
    expect(isoToIstLocal(null)).toBe("");
  });
  it("rejects impossible dates instead of rolling them over", () => {
    expect(istLocalToIso("2026-02-31T09:00")).toBeNull();
    expect(istLocalToIso("2026-13-01T09:00")).toBeNull();
    expect(istLocalToIso("2026-12-01T25:00")).toBeNull();
    expect(istLocalToIso("tomorrow")).toBeNull();
  });
  it("fills the end for 1, 3 and 5 day workshops", () => {
    expect(endForDuration("2026-12-01T09:30", 1)).toBe("2026-12-01T15:30");
    expect(endForDuration("2026-12-01T09:30", 3)).toBe("2026-12-03T15:30");
    expect(endForDuration("2026-12-30T09:30", 5)).toBe("2027-01-03T15:30");
    expect(endForDuration("", 3)).toBe("");
  });
});

describe("calendar maths", () => {
  it("builds Monday-first weeks that cover the month", () => {
    const grid = monthGrid("2026-12");
    expect(grid[0]?.[0]).toBe("2026-11-30"); // 1 Dec 2026 is a Tuesday
    expect(grid.at(-1)?.[6]).toBe("2027-01-03");
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid.flat()).toContain("2026-12-31");
  });
  it("sizes the grid to the month (4, 5 or 6 weeks)", () => {
    expect(monthGrid("2027-02")).toHaveLength(4); // Monday start, 28 days
    expect(monthGrid("2026-02")).toHaveLength(5); // Sunday start, 28 days
    expect(monthGrid("2026-08")).toHaveLength(6); // Saturday start, 31 days
  });
  it("shifts months across the year end", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("covers the visible grid in India time", () => {
    const r = gridRange("2026-12");
    expect(r.from).toBe("2026-11-29T18:30:00.000Z");
    expect(r.to).toBe("2027-01-03T18:30:00.000Z");
  });
  it("lists every India day an event touches", () => {
    expect(eventDays("2026-12-01T04:00:00Z", "2026-12-03T10:00:00Z")).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
    // 21:00 UTC is already the next morning in India
    expect(eventDays("2026-12-01T21:00:00Z", "2026-12-02T04:00:00Z")).toEqual(["2026-12-02"]);
  });
  it("groups events by day and skips undated drafts", () => {
    const a = { id: "a", starts_at: "2026-12-02T04:00:00Z", ends_at: "2026-12-03T10:00:00Z" };
    const b = { id: "b", starts_at: "2026-12-03T03:00:00Z", ends_at: "2026-12-03T09:00:00Z" };
    const draft = { id: "c", starts_at: null, ends_at: null };
    const map = eventsByDay([b, a, draft]);
    expect(map.get("2026-12-02")?.map((e) => e.id)).toEqual(["a"]);
    expect(map.get("2026-12-03")?.map((e) => e.id)).toEqual(["a", "b"]);
    expect([...map.values()].flat().some((e) => e.id === "c")).toBe(false);
  });
  it("labels the day of a multi-day event", () => {
    expect(dayOfEvent("2026-12-01T04:00:00Z", "2026-12-03T10:00:00Z", "2026-12-02")).toBe("Day 2 of 3");
    expect(dayOfEvent("2026-12-01T04:00:00Z", "2026-12-01T10:00:00Z", "2026-12-01")).toBeNull();
  });
});

describe("status moves (mirror of ops.event_guard)", () => {
  it("matches the database state machine", () => {
    expect(allowedEventMoves("draft")).toEqual(["scheduled", "cancelled"]);
    expect(allowedEventMoves("scheduled")).toEqual(["draft", "in_progress", "completed", "cancelled"]);
    expect(allowedEventMoves("in_progress")).toEqual(["completed", "cancelled"]);
    expect(allowedEventMoves("completed")).toEqual([]);
    expect(allowedEventMoves("cancelled")).toEqual([]);
  });
  it("lists what is missing before scheduling", () => {
    expect(scheduleMissing({ lead_trainer_id: null, starts_at: null, ends_at: null, venue: " ", expected_headcount: null })).toEqual([
      "lead trainer", "start", "end", "venue", "expected headcount",
    ]);
    expect(scheduleMissing({ lead_trainer_id: ID, starts_at: "x", ends_at: "y", venue: "Hall", expected_headcount: 30 })).toEqual([]);
  });
});

describe("event forms", () => {
  const base = { id: ID, title: "Workshop", starts_at: "2026-12-01T09:30", ends_at: "2026-12-01T15:30", venue: "Hall", expected_headcount: "60" };
  it("converts the form values", () => {
    const r = updateEventSchema.parse(base);
    expect(r.starts_at).toBe("2026-12-01T04:00:00.000Z");
    expect(r.expected_headcount).toBe(60);
  });
  it("allows an event with no dates yet", () => {
    const r = updateEventSchema.parse({ ...base, starts_at: "", ends_at: "", expected_headcount: "" });
    expect(r.starts_at).toBeNull();
    expect(r.expected_headcount).toBeNull();
  });
  it("needs both dates or none, in order", () => {
    expect(updateEventSchema.safeParse({ ...base, ends_at: "" }).success).toBe(false);
    expect(updateEventSchema.safeParse({ ...base, ends_at: "2026-12-01T08:00" }).success).toBe(false);
    expect(updateEventSchema.safeParse({ ...base, starts_at: "soon" }).success).toBe(false);
  });
  it("rejects a zero or fractional headcount and a blank title", () => {
    expect(updateEventSchema.safeParse({ ...base, expected_headcount: "0" }).success).toBe(false);
    expect(updateEventSchema.safeParse({ ...base, expected_headcount: "2.5" }).success).toBe(false);
    expect(updateEventSchema.safeParse({ ...base, title: "  " }).success).toBe(false);
  });
  it("limits the team", () => {
    expect(eventTeamSchema.parse({ id: ID, lead_trainer_id: "", assistants: [] }).lead_trainer_id).toBeNull();
    expect(eventTeamSchema.safeParse({ id: ID, lead_trainer_id: ID, assistants: [ID] }).success).toBe(false);
    expect(eventTeamSchema.safeParse({ id: ID, lead_trainer_id: ID, assistants: [ID2, ID2, ID2] }).success).toBe(false);
  });
  it("validates completion and cancellation", () => {
    expect(completeEventSchema.parse({ id: ID, actual_headcount: "58", satisfaction_score: "4.5" })).toMatchObject({ actual_headcount: 58, satisfaction_score: 4.5 });
    expect(completeEventSchema.parse({ id: ID, actual_headcount: "0", satisfaction_score: "" }).satisfaction_score).toBeNull();
    expect(completeEventSchema.safeParse({ id: ID, actual_headcount: "", satisfaction_score: "" }).success).toBe(false);
    expect(completeEventSchema.safeParse({ id: ID, actual_headcount: "10", satisfaction_score: "5.5" }).success).toBe(false);
    expect(cancelEventSchema.safeParse({ id: ID, reason: "  " }).success).toBe(false);
    expect(cancelEventSchema.safeParse({ id: ID, reason: "College postponed" }).success).toBe(true);
  });
  it("counts run sheet progress and what blocks completion", () => {
    const items = [
      { phase: "pre", done_at: "x" }, { phase: "pre", done_at: null }, { phase: "day", done_at: null }, { phase: "post", done_at: null },
    ];
    expect(runSheetProgress(items)).toEqual({ done: 1, total: 4, blocking: 2 });
  });
});

describe("Workshop URL state", () => {
  it("falls back to safe defaults", () => {
    expect(parseWorkshopParams({ tab: "x", month: "2026-13", status: "nope", kind: "bad", page: "-3" }, NOW)).toEqual({
      tab: "calendar", month: "2026-12", status: "open", kind: "", scope: "all", page: 1,
    });
  });
  it("round-trips, leaving defaults out", () => {
    const p = parseWorkshopParams({ tab: "events", status: "completed", kind: "fdp", scope: "mine", page: "3", month: "2027-01" }, NOW);
    expect(p).toMatchObject({ tab: "events", status: "completed", kind: "fdp", scope: "mine", page: 3, month: "2027-01" });
    expect(workshopQuery(p, NOW)).toBe("tab=events&month=2027-01&status=completed&kind=fdp&scope=mine&page=3");
    expect(workshopQuery({ tab: "calendar", month: "2026-12", status: "open", scope: "all", page: 1 }, NOW)).toBe("");
  });
});
