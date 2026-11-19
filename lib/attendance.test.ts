import { describe, expect, it } from "vitest";
import {
  dayNote, dayStatus, earlyText, formatClock, istMinutes, lateText, monthBounds, monthLabel, monthToCsv, monthTotals, networkAlert, parseMonth, shiftMonth,
  summarise, timeToMinutes, weekdayShort, type DayRow, type OfficeSettings,
} from "./attendance";

const settings = (over: Partial<OfficeSettings> = {}): OfficeSettings => ({
  start_time: "11:00:00", end_time: "17:00:00", grace_minutes: 15, work_days: [1, 2, 3, 4, 5, 6], flags_on: true, ...over,
});
const row = (over: Partial<DayRow> = {}): DayRow => ({
  staff_id: "s", work_date: "2026-11-16", expected: true, holiday: null, first_in: null, last_out: null, minutes: 0,
  is_late: false, late_minutes: 0, left_early: false, early_minutes: 0, is_open: false, missing_checkout: false,
  off_network_out: false, manual: false, mark: null, mark_reason: null, ...over,
});
const TODAY = "2026-11-18";
const kind = (r: DayRow, s = settings(), today = TODAY, now = 20 * 60) => dayStatus(r, s, today, now).kind;

describe("clock helpers", () => {
  it("reads times", () => {
    expect(timeToMinutes("11:15:00")).toBe(675);
    expect(formatClock("11:00:00")).toBe("11:00 am");
    expect(formatClock("17:00:00")).toBe("5:00 pm");
    expect(formatClock("12:30:00")).toBe("12:30 pm");
    expect(formatClock("00:05:00")).toBe("12:05 am");
  });
  it("finds the minute of the day in India", () => {
    expect(istMinutes(new Date("2026-11-17T18:30:00Z"))).toBe(0);
    expect(istMinutes(new Date("2026-11-18T06:42:00Z"))).toBe(732);
  });
  it("words lateness", () => {
    expect(lateText(22)).toBe("22 min late");
    expect(lateText(75)).toBe("1h 15m late");
    expect(earlyText(30)).toBe("left 30 min early");
  });
});

describe("dayStatus", () => {
  it("a full day is present", () => {
    expect(kind(row({ first_in: "x", last_out: "y", minutes: 360 }))).toBe("present");
  });
  it("an open stretch is in the office", () => {
    expect(kind(row({ first_in: "x", is_open: true, work_date: TODAY }))).toBe("in");
  });
  it("an open remote stretch does not say the office", () => {
    expect(dayStatus(row({ first_in: "x", is_open: true, remote: true, work_date: TODAY }), settings(), TODAY, 20 * 60).label).toBe("Checked in remotely");
  });
  it("a missing check-out wins over everything", () => {
    expect(kind(row({ first_in: "x", missing_checkout: true, is_late: true }))).toBe("missing");
  });
  it("late, early and both", () => {
    expect(kind(row({ first_in: "x", last_out: "y", is_late: true, late_minutes: 20 }))).toBe("late");
    expect(kind(row({ first_in: "x", last_out: "y", left_early: true, early_minutes: 30 }))).toBe("early");
    expect(kind(row({ first_in: "x", last_out: "y", is_late: true, left_early: true }))).toBe("late_early");
  });
  it("shadow mode records but does not flag", () => {
    const off = settings({ flags_on: false });
    expect(kind(row({ first_in: "x", last_out: "y", is_late: true, left_early: true }), off)).toBe("present");
    expect(dayStatus(row(), off, TODAY, 0).label).toBe("No record");
  });
  it("a day without a record", () => {
    expect(kind(row())).toBe("absent");
    expect(kind(row({ holiday: "Diwali", expected: false }))).toBe("holiday");
    expect(kind(row({ mark: "excused" }))).toBe("excused");
    expect(kind(row({ mark: "remote" }))).toBe("remote");
    expect(kind(row({ expected: false }))).toBe("off");
  });
  it("a day that has not come is upcoming, not absent", () => {
    expect(kind(row({ work_date: "2026-11-20" }))).toBe("upcoming");
    expect(kind(row({ work_date: "2026-11-20", expected: false }))).toBe("off");
    expect(kind(row({ work_date: "2026-11-20", holiday: "Diwali", expected: false }))).toBe("holiday");
  });
  it("a holiday beats a mark; a mark beats a day off", () => {
    expect(kind(row({ holiday: "Diwali", mark: "remote", expected: false }))).toBe("holiday");
    expect(kind(row({ mark: "remote", expected: false }))).toBe("remote");
  });
  it("today before the end of office hours is not absent yet", () => {
    expect(kind(row({ work_date: TODAY }), settings(), TODAY, 10 * 60)).toBe("not_yet");
    expect(kind(row({ work_date: TODAY }), settings(), TODAY, 16 * 60 + 59)).toBe("not_yet");
    expect(kind(row({ work_date: TODAY }), settings(), TODAY, 17 * 60)).toBe("absent");
  });
  it("not yet turns amber after the leeway", () => {
    expect(dayStatus(row({ work_date: TODAY }), settings(), TODAY, 11 * 60 + 15).tone).toBe("slate");
    expect(dayStatus(row({ work_date: TODAY }), settings(), TODAY, 11 * 60 + 16).tone).toBe("amber");
  });
  it("presence beats a remote mark", () => {
    expect(kind(row({ first_in: "x", last_out: "y", mark: "remote" }))).toBe("present");
  });
});

describe("summarise", () => {
  const rows = [
    row({ work_date: "2026-11-16", first_in: "x", last_out: "y", minutes: 360 }),
    row({ work_date: "2026-11-17", first_in: "x", last_out: "y", minutes: 300, is_late: true, late_minutes: 30 }),
    row({ work_date: "2026-11-15" }),
    row({ work_date: "2026-11-14", first_in: "x", missing_checkout: true }),
  ];
  it("counts", () => {
    expect(summarise(rows, settings(), TODAY, 20 * 60)).toEqual({ present: 3, late: 1, early: 0, absent: 1, missing: 1, minutes: 660 });
  });
  it("counts nothing but presence and hours in shadow mode", () => {
    expect(summarise(rows, settings({ flags_on: false }), TODAY, 20 * 60)).toEqual({ present: 3, late: 0, early: 0, absent: 0, missing: 1, minutes: 660 });
  });
});

describe("networkAlert", () => {
  it("fires when three or more people were refused", () => {
    expect(networkAlert(new Map([["a", 1], ["b", 2]]))).toBe(false);
    expect(networkAlert(new Map([["a", 1], ["b", 2], ["c", 1]]))).toBe(true);
  });
});

describe("month helpers", () => {
  it("knows the bounds, including leap years", () => {
    expect(monthBounds("2026-11")).toEqual({ first: "2026-11-01", last: "2026-11-30", days: 30 });
    expect(monthBounds("2028-02").last).toBe("2028-02-29");
    expect(monthBounds("2026-02").days).toBe(28);
    expect(() => monthBounds("2026-13")).toThrow();
  });
  it("reads a month from the address bar or falls back to today's", () => {
    expect(parseMonth("2026-09", "2026-11-18")).toBe("2026-09");
    expect(parseMonth(["2026-09", "2026-10"], "2026-11-18")).toBe("2026-09");
    expect(parseMonth("2026-13", "2026-11-18")).toBe("2026-11");
    expect(parseMonth("nonsense", "2026-11-18")).toBe("2026-11");
    expect(parseMonth(undefined, "2026-11-18")).toBe("2026-11");
  });
  it("steps across year ends", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 0)).toBe("2026-11");
  });
  it("labels in words", () => {
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(weekdayShort("2026-11-18")).toBe("Wed");
  });
});

describe("not tracked yet", () => {
  it("a working day before check-in began reads as not tracked, not absent", () => {
    expect(kind(row({ work_date: "2026-10-01", tracked: false }))).toBe("not_tracked");
  });
  it("a holiday or day off before that still reads as itself", () => {
    expect(kind(row({ work_date: "2026-10-02", tracked: false, holiday: "Gandhi Jayanti" }))).toBe("holiday");
    expect(kind(row({ work_date: "2026-10-04", tracked: false, expected: false }))).toBe("off");
  });
  it("a day with a record is shown as such even if marked untracked", () => {
    expect(kind(row({ tracked: false, first_in: "x", last_out: "y", minutes: 60 }))).toBe("present");
  });
});

describe("monthTotals", () => {
  const month = [
    row({ work_date: "2026-11-02", first_in: "x", last_out: "y", minutes: 400, remote: true }),
    row({ work_date: "2026-11-03", first_in: "x", last_out: "y", minutes: 200, is_late: true, late_minutes: 30 }),
    row({ work_date: "2026-11-04" }),
    row({ work_date: "2026-11-05", holiday: "Diwali", expected: false }),
    row({ work_date: "2026-11-18" }),
    row({ work_date: "2026-11-25" }),
    row({ work_date: "2026-10-30", tracked: false }),
  ];
  it("counts what was expected up to today and never the future or untracked days", () => {
    const t = monthTotals(month, settings(), TODAY, 20 * 60);
    expect(t).toMatchObject({ workingDays: 4, present: 2, late: 1, absent: 2, holidays: 1, remoteDays: 1, minutes: 600, averageMinutes: 300 });
  });
  it("counts no absences or lateness in shadow mode", () => {
    const t = monthTotals(month, settings({ flags_on: false }), TODAY, 20 * 60);
    expect(t).toMatchObject({ present: 2, late: 0, absent: 0 });
  });
  it("an empty month is all zeros", () => {
    expect(monthTotals([], settings(), TODAY, 0)).toEqual({ workingDays: 0, present: 0, absent: 0, late: 0, early: 0, missing: 0, holidays: 0, remoteDays: 0, leaveDays: 0, minutes: 0, averageMinutes: 0 });
  });
});

describe("leave on the attendance sheet", () => {
  it("names the leave and is not absent", () => {
    const s = dayStatus(row({ leave_name: "Casual leave", expected: false }), settings(), TODAY, 20 * 60);
    expect(s).toMatchObject({ kind: "leave", label: "On leave (Casual)" });
    expect(dayStatus(row({ leave_name: "Sick leave", leave_half: true }), settings(), TODAY, 20 * 60).label).toBe("Half-day leave (Sick)");
  });
  it("a holiday still wins, and so does being there", () => {
    expect(kind(row({ leave_name: "Casual leave", holiday: "Diwali", expected: false }))).toBe("holiday");
    expect(kind(row({ leave_name: "Casual leave", first_in: "x", last_out: "y", minutes: 60 }))).toBe("present");
  });
  it("approved leave is not counted as an absence", () => {
    const month = [row({ work_date: "2026-11-02", leave_name: "Casual leave", expected: false }), row({ work_date: "2026-11-03", leave_name: "Sick leave", leave_half: true }), row({ work_date: "2026-11-04" })];
    expect(monthTotals(month, settings(), TODAY, 20 * 60)).toMatchObject({ absent: 1, leaveDays: 1.5 });
  });
});

describe("month export", () => {
  it("writes one line per day with a header", () => {
    const csv = monthToCsv([row({ work_date: "2026-11-16", first_in: "2026-11-16T05:30:00Z", last_out: "2026-11-16T11:30:00Z", minutes: 360 })], settings(), TODAY, 20 * 60);
    const [head, line] = csv.split("\r\n");
    expect(head).toBe("Date,Day,Status,In,Out,Worked,Note");
    expect(line).toBe("2026-11-16,Mon,Present,11:00 am,5:00 pm,6h 00m,");
  });
  it("defuses spreadsheet formulas and quotes commas", () => {
    const csv = monthToCsv([row({ work_date: "2026-11-05", expected: false, holiday: "=HYPERLINK(\"x\")" }), row({ work_date: "2026-11-06", mark: "excused", mark_reason: "Fever, rest" })], settings(), TODAY, 20 * 60);
    expect(csv).toContain("'=HYPERLINK(\"\"x\"\")");
    expect(csv).toContain('"Fever, rest"');
  });
  it("notes remote and manual days", () => {
    expect(dayNote(row({ first_in: "x", remote: true, manual: true }))).toBe("Remote; Added by a lead");
    expect(dayNote(row())).toBe("");
  });
});
