import { describe, expect, it } from "vitest";
import {
  dailyLogSchema, elapsedMinutes, formatHM, manualEntrySchema, parseDuration, parseWeek, weekDays, weekStart,
} from "./time";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("parseDuration", () => {
  it("reads the common ways people type a length", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("1h")).toBe(60);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("1h30")).toBe(90);
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration(" 2 hrs ")).toBe(120);
  });
  it("refuses nonsense", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("-5")).toBeNull();
    expect(parseDuration("1:75")).toBeNull();
  });
});

describe("manualEntrySchema", () => {
  const base = { task_id: UUID, work_date: "2020-01-02", minutes: "1h 30m" };
  it("turns the length into minutes and empty notes into null", () => {
    expect(manualEntrySchema.parse({ ...base, note: "  " })).toMatchObject({ minutes: 90, note: null });
  });
  it("refuses a future day, zero, or more than 16 hours", () => {
    expect(manualEntrySchema.safeParse({ ...base, work_date: "2099-01-01" }).success).toBe(false);
    expect(manualEntrySchema.safeParse({ ...base, minutes: "0" }).success).toBe(false);
    expect(manualEntrySchema.safeParse({ ...base, minutes: "17h" }).success).toBe(false);
  });
});

describe("dailyLogSchema", () => {
  it("needs what you did and trims the rest", () => {
    expect(dailyLogSchema.safeParse({ log_date: "2020-01-02", did: "  " }).success).toBe(false);
    expect(dailyLogSchema.parse({ log_date: "2020-01-02", did: " Done ", blockers: "  " })).toEqual({ log_date: "2020-01-02", did: "Done", next_up: null, blockers: null });
    expect(dailyLogSchema.safeParse({ log_date: "2099-01-01", did: "x" }).success).toBe(false);
  });
});

describe("weeks", () => {
  it("starts on Monday", () => {
    expect(weekStart("2026-03-04")).toBe("2026-03-02");
    expect(weekStart("2026-03-08")).toBe("2026-03-02");
    expect(weekStart("2026-03-02")).toBe("2026-03-02");
    expect(weekDays("2026-03-02")).toHaveLength(7);
    expect(weekDays("2026-03-02")[6]).toBe("2026-03-08");
  });
  it("falls back to this week", () => {
    expect(parseWeek("garbage", "2026-03-04")).toBe("2026-03-02");
    expect(parseWeek("2026-03-11", "2026-03-04")).toBe("2026-03-09");
  });
});

describe("time display", () => {
  it("formats", () => {
    expect(formatHM(0)).toBe("0m");
    expect(formatHM(45)).toBe("45m");
    expect(formatHM(65)).toBe("1h 05m");
    expect(elapsedMinutes("2026-03-02T10:00:00Z", Date.parse("2026-03-02T10:45:30Z"))).toBe(45);
    expect(elapsedMinutes("2026-03-02T10:00:00Z", Date.parse("2026-03-02T09:00:00Z"))).toBe(0);
  });
});
