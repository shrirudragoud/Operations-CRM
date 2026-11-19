import { describe, expect, it } from "vitest";
import {
  availableShare, awayByPerson, canDecideLeave, canTakeLeave, canWithdraw, daysText, isAwayOn, num, policySummary, previewDays, rangeText, shiftDate,
  type AwayRow,
} from "./leave";
import { applySchema, decideSchema, leaveTypeSchema } from "./schemas/leave";
import type { Me } from "./permissions";

const me = (over: Partial<Me> = {}): Me => ({ id: "8b3c1d1e-2f4a-4c1e-9a52-0d1f4f9a7b11", full_name: "A B", email: "a@b.c", role: "member", departments: ["sales"], ...over });
const WEEKDAYS = [1, 2, 3, 4, 5];
const none = new Set<string>();
const plain = { count_weekends: false, count_holidays: false };

describe("who can do what", () => {
  it("viewers and partners cannot take leave", () => {
    expect(canTakeLeave(me())).toBe(true);
    expect(canTakeLeave(me({ role: "dept_lead" }))).toBe(true);
    expect(canTakeLeave(me({ role: "viewer" }))).toBe(false);
    expect(canTakeLeave(me({ role: "partner", departments: [] }))).toBe(false);
    expect(canTakeLeave(null)).toBe(false);
  });
  it("HR, the founder and leads decide; members do not", () => {
    expect(canDecideLeave(me())).toBe(false);
    expect(canDecideLeave(me({ role: "dept_lead" }))).toBe(true);
    expect(canDecideLeave(me({ is_hr: true }))).toBe(true);
    expect(canDecideLeave(me({ role: "founder", departments: [] }))).toBe(true);
    expect(canDecideLeave(me({ role: "viewer", is_hr: true }))).toBe(false);
  });
});

describe("words", () => {
  it("counts days", () => {
    expect(daysText(1)).toBe("1 day");
    expect(daysText(3)).toBe("3 days");
    expect(daysText(2.5)).toBe("2.5 days");
    expect(daysText(0.5)).toBe("Half a day");
    expect(num("12.0")).toBe(12);
    expect(num(null)).toBe(0);
  });
  it("writes a range", () => {
    expect(rangeText("2026-03-12", "2026-03-12")).toBe("12 Mar");
    expect(rangeText("2026-03-12", "2026-03-14")).toBe("12 to 14 Mar");
    expect(rangeText("2026-03-30", "2026-04-02")).toBe("30 Mar to 2 Apr");
    expect(rangeText("2026-03-12", "2026-03-12", "first_half")).toBe("12 Mar (first half)");
    expect(rangeText("2027-03-12", "2027-03-12", "full", "2026")).toBe("12 Mar 2027");
  });
  it("sums a policy up for HR", () => {
    expect(policySummary({ has_balance: true, annual_quota: 15, carry_forward: true, carry_cap: 30, count_weekends: false, count_holidays: false, paid: true }))
      .toBe("15 days a year, carries over up to 30 days, weekends skipped, holidays skipped, paid");
    expect(policySummary({ has_balance: false, annual_quota: 0, carry_forward: false, carry_cap: null, count_weekends: true, count_holidays: true, paid: false }))
      .toBe("No balance kept, weekends count, holidays count, unpaid");
    expect(policySummary({ has_balance: true, annual_quota: 12, carry_forward: true, carry_cap: null, count_weekends: false, count_holidays: false, paid: true }))
      .toContain("carries over, ");
  });
});

describe("previewDays mirrors the database count", () => {
  // 2026-03-02 is a Monday.
  it("skips weekends unless the type counts them", () => {
    expect(previewDays(plain, "2026-03-02", "2026-03-06", "full", WEEKDAYS, none)).toBe(5);
    expect(previewDays(plain, "2026-03-06", "2026-03-09", "full", WEEKDAYS, none)).toBe(2);
    expect(previewDays({ ...plain, count_weekends: true }, "2026-03-06", "2026-03-09", "full", WEEKDAYS, none)).toBe(4);
  });
  it("skips holidays unless the type counts them", () => {
    const hol = new Set(["2026-03-09"]);
    expect(previewDays(plain, "2026-03-06", "2026-03-09", "full", WEEKDAYS, hol)).toBe(1);
    expect(previewDays({ ...plain, count_holidays: true }, "2026-03-06", "2026-03-09", "full", WEEKDAYS, hol)).toBe(2);
  });
  it("turning both on counts every calendar day", () => {
    const hol = new Set(["2026-03-09"]);
    expect(previewDays({ count_weekends: true, count_holidays: true }, "2026-03-06", "2026-03-09", "full", WEEKDAYS, hol)).toBe(4);
  });
  it("a half day is half, and a weekend alone is nothing", () => {
    expect(previewDays(plain, "2026-03-02", "2026-03-02", "first_half", WEEKDAYS, none)).toBe(0.5);
    expect(previewDays(plain, "2026-03-07", "2026-03-08", "full", WEEKDAYS, none)).toBe(0);
  });
  it("a backwards or empty range is nothing", () => {
    expect(previewDays(plain, "2026-03-05", "2026-03-02", "full", WEEKDAYS, none)).toBe(0);
    expect(previewDays(plain, "", "", "full", WEEKDAYS, none)).toBe(0);
  });
  it("a day's weight is the same however the range is cut (additive)", () => {
    const whole = previewDays(plain, "2026-03-02", "2026-03-20", "full", WEEKDAYS, none);
    const split = previewDays(plain, "2026-03-02", "2026-03-10", "full", WEEKDAYS, none) + previewDays(plain, "2026-03-11", "2026-03-20", "full", WEEKDAYS, none);
    expect(split).toBe(whole);
  });
  it("a six-day week counts Saturdays", () => {
    expect(previewDays(plain, "2026-03-02", "2026-03-07", "full", [1, 2, 3, 4, 5, 6], none)).toBe(6);
  });
});

describe("balances and withdrawing", () => {
  it("a meter shows what is still free", () => {
    expect(availableShare({ annual_quota: 12, balance: 12, available: 12 })).toBe(100);
    expect(availableShare({ annual_quota: 12, balance: 9, available: 6 })).toBe(50);
    expect(availableShare({ annual_quota: 12, balance: 0, available: 0 })).toBe(0);
    expect(availableShare({ annual_quota: 0, balance: 0, available: 0 })).toBe(0);
    expect(availableShare({ annual_quota: 15, balance: 25, available: 25 })).toBe(100);
  });
  it("pending can be withdrawn, approved only before it starts, unless HR", () => {
    expect(canWithdraw({ state: "pending", from_date: "2026-03-01" }, "2026-03-05", false)).toBe(true);
    expect(canWithdraw({ state: "approved", from_date: "2026-03-10" }, "2026-03-05", false)).toBe(true);
    expect(canWithdraw({ state: "approved", from_date: "2026-03-05" }, "2026-03-05", false)).toBe(false);
    expect(canWithdraw({ state: "approved", from_date: "2026-03-05" }, "2026-03-05", true)).toBe(true);
    expect(canWithdraw({ state: "rejected", from_date: "2026-03-10" }, "2026-03-05", true)).toBe(false);
  });
});

describe("shiftDate", () => {
  it("moves a day across month and year ends", () => {
    expect(shiftDate("2026-03-30", 3)).toBe("2026-04-02");
    expect(shiftDate("2026-01-02", -3)).toBe("2025-12-30");
  });
});

describe("who is away", () => {
  const rows: AwayRow[] = [
    { request_id: "1", staff_id: "a", full_name: "Asha", leave_type: null, from_date: "2026-03-02", to_date: "2026-03-04", day_part: "full" },
    { request_id: "2", staff_id: "a", full_name: "Asha", leave_type: null, from_date: "2026-03-10", to_date: "2026-03-10", day_part: "first_half" },
    { request_id: "3", staff_id: "b", full_name: "Bhavik", leave_type: "Sick leave", from_date: "2026-03-03", to_date: "2026-03-03", day_part: "full" },
  ];
  it("groups one line per person", () => {
    const g = awayByPerson(rows);
    expect(g.map((x) => [x.full_name, x.items.length])).toEqual([["Asha", 2], ["Bhavik", 1]]);
  });
  it("knows who is away on a day", () => {
    expect(isAwayOn(rows, "a", "2026-03-03")).toBe(true);
    expect(isAwayOn(rows, "a", "2026-03-05")).toBe(false);
    expect(isAwayOn(rows, "b", "2026-03-03")).toBe(true);
  });
});

describe("forms", () => {
  const ok = { leave_type_id: "8b3c1d1e-2f4a-4c1e-9a52-0d1f4f9a7b11", from_date: "2026-03-02", to_date: "2026-03-03", day_part: "full", reason: "Family function" } as const;
  it("accepts a normal application", () => {
    expect(applySchema.safeParse(ok).success).toBe(true);
  });
  it("refuses a backwards range, a year split and a half day over several days", () => {
    expect(applySchema.safeParse({ ...ok, to_date: "2026-03-01" }).success).toBe(false);
    expect(applySchema.safeParse({ ...ok, from_date: "2026-12-30", to_date: "2027-01-02" }).success).toBe(false);
    expect(applySchema.safeParse({ ...ok, day_part: "first_half" }).success).toBe(false);
    expect(applySchema.safeParse({ ...ok, to_date: "2026-03-02", day_part: "first_half" }).success).toBe(true);
  });
  it("needs a reason", () => {
    expect(applySchema.safeParse({ ...ok, reason: " " }).success).toBe(false);
  });
  it("turning a request down needs a reason; approving does not", () => {
    const id = "8b3c1d1e-2f4a-4c1e-9a52-0d1f4f9a7b11";
    expect(decideSchema.safeParse({ id, approve: true }).success).toBe(true);
    expect(decideSchema.safeParse({ id, approve: false }).success).toBe(false);
    expect(decideSchema.safeParse({ id, approve: false, note: "Release day" }).success).toBe(true);
  });
  it("a leave type reads its numbers and an empty cap as no cap", () => {
    const t = leaveTypeSchema.parse({
      name: " Earned leave ", code: "Earned", paid: true, has_balance: true, annual_quota: "15", carry_forward: true, carry_cap: "",
      count_weekends: false, count_holidays: false, half_day_allowed: true, needs_document: false, is_active: true,
    });
    expect(t).toMatchObject({ name: "Earned leave", code: "earned", annual_quota: 15, carry_cap: null });
    expect(leaveTypeSchema.safeParse({ ...t, carry_cap: "10" }).data?.carry_cap).toBe(10);
    expect(leaveTypeSchema.safeParse({ ...t, annual_quota: -1 }).success).toBe(false);
    expect(leaveTypeSchema.safeParse({ ...t, code: "Bad Code" }).success).toBe(false);
  });
});
