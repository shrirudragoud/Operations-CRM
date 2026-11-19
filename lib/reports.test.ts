import { describe, expect, it } from "vitest";
import type { DayRow, OfficeSettings } from "./attendance";
import type { TaskRow } from "./ops-insight";
import type { Me } from "./permissions";
import {
  REPORT_KEYS, attendanceReport, canRunReport, institutionsReport, leaveReport, lastMonth, parseRange, pipelineReport, reportFilename,
  reportsFor, tableToCsv, thisMonth, timeReport, timelinessReport, weightedValue,
} from "./reports";

const me = (role: Me["role"], departments: Me["departments"] = [], extra: Partial<Me> = {}): Me => ({
  id: "00000000-0000-4000-8000-000000000001", full_name: "T", email: "t@x.in", role, departments, ...extra,
});

describe("who can run what", () => {
  it("gives the founder every report", () => {
    expect(reportsFor(me("founder"))).toEqual([...REPORT_KEYS]);
  });
  it("gives a sales lead every report, and a lead outside Sales no pipeline", () => {
    expect(reportsFor(me("dept_lead", ["sales"]))).toEqual(["pipeline", "institutions", "timeliness", "time", "attendance", "leave"]);
    expect(canRunReport(me("dept_lead", ["workshop"]), "pipeline")).toBe(false);
  });
  it("gives an HR member only attendance and leave", () => {
    expect(reportsFor(me("member", ["product"], { is_hr: true }))).toEqual(["attendance", "leave"]);
  });
  it("gives members, viewers and partners nothing", () => {
    for (const role of ["member", "viewer", "partner"] as const) expect(reportsFor(me(role, ["sales"])), role).toEqual([]);
  });
  it("gives nobody without a staff row nothing", () => {
    expect(reportsFor(null)).toEqual([]);
  });
});

describe("parseRange", () => {
  const today = "2026-11-20";
  it("defaults to this month", () => {
    expect(parseRange({}, today)).toEqual({ from: "2026-11-01", to: "2026-11-30", cut: false });
  });
  it("ignores unreal dates", () => {
    expect(parseRange({ from: "2026-02-31", to: "nope" }, today)).toEqual({ from: "2026-11-01", to: "2026-11-30", cut: false });
  });
  it("turns a backwards range round", () => {
    expect(parseRange({ from: "2026-11-10", to: "2026-11-02" }, today)).toEqual({ from: "2026-11-02", to: "2026-11-10", cut: false });
  });
  it("cuts a long range to the limit", () => {
    expect(parseRange({ from: "2026-01-01", to: "2026-12-31" }, today, 62)).toEqual({ from: "2026-01-01", to: "2026-03-03", cut: true });
  });
  it("takes the first of repeated values", () => {
    expect(parseRange({ from: ["2026-11-03", "x"], to: "2026-11-04" }, today).from).toBe("2026-11-03");
  });
  it("knows this and last month, across a year end", () => {
    expect(thisMonth("2026-12-15")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(lastMonth("2027-01-05")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

const range = { from: "2026-11-01", to: "2026-11-30" };

describe("pipeline", () => {
  const deal = (o: Partial<Parameters<typeof pipelineReport>[0][number]>) => ({
    title: "D", stage: "proposal", value_inr: 100000, probability: 40, expected_close: "2026-11-10", institution: { name: "ABC School" }, owner: { full_name: "Asha" }, ...o,
  });
  it("weights open deals by chance, won in full, lost at nothing", () => {
    expect(weightedValue(deal({}))).toBe(40000);
    expect(weightedValue(deal({ stage: "won", probability: 100 }))).toBe(100000);
    expect(weightedValue(deal({ stage: "lost" }))).toBe(0);
    expect(weightedValue(deal({ probability: null }))).toBe(40000);
  });
  it("keeps deals closing in range, leaves out lost ones, orders by date and totals", () => {
    const t = pipelineReport(
      [deal({ title: "B", expected_close: "2026-11-20" }), deal({ title: "A", expected_close: "2026-11-05", value_inr: "50000" }), deal({ title: "X", stage: "lost" }), deal({ title: "Out", expected_close: "2026-12-01" }), deal({ title: "None", expected_close: null })],
      range,
    );
    expect(t.rows.map((r) => r[1])).toEqual(["A", "B"]);
    expect(t.totals).toEqual(["Total", "2 deals", null, null, null, 150000, null, 60000]);
  });
  it("has no totals line when empty", () => {
    expect(pipelineReport([], range).totals).toBeNull();
  });
});

describe("institutions", () => {
  it("counts every stage, and those created in the range in India time", () => {
    const t = institutionsReport(
      [
        { stage: "prospect", created_at: "2026-11-10T08:00:00Z" },
        { stage: "prospect", created_at: "2026-10-31T19:00:00Z" }, // 1 Nov 00:30 in India: inside
        { stage: "prospect", created_at: "2026-10-31T10:00:00Z" }, // 31 Oct in India: outside
        { stage: "active", created_at: "2026-01-01T00:00:00Z" },
      ],
      range,
    );
    expect(t.rows).toHaveLength(10);
    expect(t.rows[0]).toEqual(["Prospect", 3, 2]);
    expect(t.rows.find((r) => r[0] === "Active")).toEqual(["Active", 1, 0]);
    expect(t.totals).toEqual(["Total", 4, 2]);
  });
});

describe("timeliness", () => {
  const task = (o: Partial<TaskRow>): TaskRow => ({
    task_id: "t", title: "T", department: null, priority: 3, status: "done", assignee_id: "a", created_day: "2026-11-01", done_day: "2026-11-10", due_date: "2026-11-10",
    original_due_date: null, bucket: "on_time", days_late: null, estimate_minutes: null, logged_minutes: 0, blocked_minutes: 0, reschedules: 0, reassigns: 0, ...o,
  });
  const names = new Map([["a", "Asha"], ["b", "Bala"]]);
  it("counts finished tasks by bucket, and open and overdue ones as of today", () => {
    const t = timelinessReport(
      [
        task({ bucket: "early" }),
        task({ bucket: "on_time" }),
        task({ bucket: "late", days_late: 2 }),
        task({ bucket: "late", days_late: 4 }),
        task({ done_day: "2026-10-30" }), // finished outside the dates
        task({ status: "todo", done_day: null, bucket: null, due_date: "2026-11-15" }), // overdue
        task({ status: "doing", done_day: null, bucket: null, due_date: "2026-11-25" }),
        task({ assignee_id: "b", status: "todo", done_day: null, bucket: null, due_date: null }),
        task({ assignee_id: null, status: "todo", done_day: null, bucket: null, due_date: null }),
      ],
      names,
      range,
      "2026-11-20",
    );
    expect(t.rows[0]).toEqual(["Asha", 4, 1, 1, 2, 50, 3, 2, 1]);
    expect(t.rows.map((r) => r[0])).toEqual(["Asha", "Bala", "Not assigned"]);
    expect(t.totals?.slice(0, 5)).toEqual(["Total", 4, 1, 1, 2]);
    expect(t.totals?.[7]).toBe(4);
  });
});

describe("time", () => {
  it("adds minutes into hours per person and task, ignoring running timers", () => {
    const e = (staff_id: string, task_id: string, minutes: number | null, person = "Asha", title = "Build") => ({
      staff_id, task_id, minutes, staff: { full_name: person }, task: { title },
    });
    const t = timeReport([e("a", "1", 90), e("a", "1", 30), e("a", "2", 60, "Asha", "Test"), e("b", "1", 45, "Bala"), e("a", "1", null)], range);
    expect(t.rows).toEqual([["Asha", "Build", 2, 2], ["Asha", "Test", 1, 1], ["Bala", "Build", 1, 0.75]]);
    expect(t.totals).toEqual(["Total", null, 4, 3.75]);
  });
});

describe("attendance", () => {
  const settings: OfficeSettings = { start_time: "09:00:00", end_time: "18:00:00", grace_minutes: 10, work_days: [1, 2, 3, 4, 5], flags_on: true };
  const day = (o: Partial<DayRow>): DayRow => ({
    staff_id: "a", work_date: "2026-11-02", expected: true, holiday: null, first_in: "2026-11-02T04:00:00Z", last_out: "2026-11-02T12:30:00Z", minutes: 510, is_late: false,
    late_minutes: 0, left_early: false, early_minutes: 0, is_open: false, missing_checkout: false, off_network_out: false, manual: false, mark: null, mark_reason: null, tracked: true, ...o,
  });
  it("counts present, late, no check-out, absent, leave and hours per person", () => {
    const t = attendanceReport(
      [
        day({}),
        day({ work_date: "2026-11-03", is_late: true, late_minutes: 20, minutes: 480 }),
        day({ work_date: "2026-11-04", first_in: null, last_out: null, minutes: 0 }), // absent
        day({ work_date: "2026-11-05", first_in: null, last_out: null, minutes: 0, leave_name: "Casual leave" }),
        day({ work_date: "2026-11-06", missing_checkout: true, last_out: null, minutes: 0 }),
        day({ staff_id: "b" }),
      ],
      new Map([["a", "Asha"], ["b", "Bala"]]),
      settings,
      "2026-11-20",
      600,
      range,
    );
    expect(t.rows[0]).toEqual(["Asha", 3, 1, 0, 1, 1, 1, 16.5]);
    expect(t.rows[1]?.[0]).toBe("Bala");
    expect(t.totals?.[1]).toBe(4);
  });
  it("says so when flags are off", () => {
    const t = attendanceReport([day({})], new Map([["a", "Asha"]]), { ...settings, flags_on: false }, "2026-11-20", 600, range);
    expect(t.notes.join(" ")).toMatch(/flags/);
  });
});

describe("leave", () => {
  const r = (o: Partial<Parameters<typeof leaveReport>[0][number]>) => ({
    from_date: "2026-11-10", to_date: "2026-11-11", days: "2", state: "approved", staff: { full_name: "Asha" }, type: { name: "Casual" }, ...o,
  });
  it("keeps requests overlapping the dates, sums approved days only", () => {
    const t = leaveReport(
      [r({}), r({ from_date: "2026-10-29", to_date: "2026-11-02", days: 3 }), r({ state: "pending", days: 1 }), r({ from_date: "2026-12-01", to_date: "2026-12-02" }), r({ state: "rejected", days: 5 })],
      range,
    );
    expect(t.rows).toHaveLength(4);
    expect(t.rows[0]?.[2]).toBe("2026-10-29");
    expect(t.totals).toEqual(["Approved days", null, null, null, 5, null]);
  });
});

describe("tableToCsv", () => {
  it("writes the header, the rows and the totals, and neutralises formulas", () => {
    const t = leaveReport([{ from_date: "2026-11-10", to_date: "2026-11-10", days: 1, state: "approved", staff: { full_name: "=cmd|' /C calc'!A0" }, type: { name: "Casual" } }], range);
    const lines = tableToCsv(t).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Person,Leave,From,To,Days,Status");
    expect(lines[1]).toBe("'=cmd|' /C calc'!A0,Casual,2026-11-10,2026-11-10,1,Approved");
    expect(lines[2]).toBe("Approved days,,,,1,");
  });
  it("names the file by report and dates", () => {
    expect(reportFilename("leave", range)).toBe("leave-2026-11-01-to-2026-11-30.csv");
  });
});
