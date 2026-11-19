import { describe, expect, it } from "vitest";
import {
  backlogSeries, buildScope, dailySeries, delta, normalizeRows, heatmap, inScope, insightQuery, isWeekend, latenessBands, overdueAge, parseInsightParams, peopleByWeek,
  peopleTable, periodRange, planVsActual, shiftPeriod, summarize, weekLines, weekdayProfile, workingDaysIn, type BacklogRow, type Scope, type TaskRow,
} from "./ops-insight";

// 16 Nov 2026 is a Monday.
const TODAY = "2026-11-18";
const DEPTS = ["sales", "workshop"];

let n = 0;
function task(over: Partial<TaskRow>): TaskRow {
  n += 1;
  return {
    task_id: `t${n}`, title: `Task ${n}`, department: "sales", priority: 3, status: "done", assignee_id: "a",
    created_day: "2026-11-10", done_day: "2026-11-18", due_date: "2026-11-18", original_due_date: "2026-11-18", bucket: "on_time", days_late: null,
    estimate_minutes: null, logged_minutes: 0, blocked_minutes: 0, reschedules: 0, reassigns: 0, ...over,
  };
}
const open = (over: Partial<TaskRow>) => task({ status: "todo", done_day: null, bucket: null, ...over });

describe("dates", () => {
  it("knows the weekend and counts working days", () => {
    expect(isWeekend("2026-11-21")).toBe(true);
    expect(isWeekend("2026-11-20")).toBe(false);
    expect(workingDaysIn("2026-11-16", "2026-11-22")).toBe(5);
    expect(workingDaysIn("2026-11-21", "2026-11-22")).toBe(0);
  });
  it("finds the week and month around a day, and the ones before", () => {
    const w = periodRange("week", "2026-11-18");
    expect([w.from, w.to, w.prevFrom, w.prevTo]).toEqual(["2026-11-16", "2026-11-22", "2026-11-09", "2026-11-15"]);
    const m = periodRange("month", "2026-11-18");
    expect([m.from, m.to, m.prevFrom, m.prevTo]).toEqual(["2026-11-01", "2026-11-30", "2026-10-01", "2026-10-31"]);
    const jan = periodRange("month", "2026-01-10");
    expect([jan.prevFrom, jan.prevTo]).toEqual(["2025-12-01", "2025-12-31"]);
  });
  it("compares Monday with the previous Friday, not Sunday", () => {
    const t = periodRange("today", "2026-11-16");
    expect(t.prevFrom).toBe("2026-11-13");
  });
  it("steps between periods", () => {
    expect(shiftPeriod("week", "2026-11-18", -1)).toBe("2026-11-11");
    expect(shiftPeriod("month", "2026-11-18", -1)).toBe("2026-10-31");
    expect(shiftPeriod("month", "2026-11-18", 1)).toBe("2026-12-01");
    expect(shiftPeriod("today", "2026-11-16", -1)).toBe("2026-11-13");
    expect(shiftPeriod("today", "2026-11-13", 1)).toBe("2026-11-16");
  });
});

describe("parseInsightParams", () => {
  it("falls back to this week, today, no filters", () => {
    expect(parseInsightParams({}, TODAY, DEPTS)).toEqual({ period: "week", on: TODAY, department: null, person: null });
  });
  it("accepts valid values", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(parseInsightParams({ period: "month", on: "2026-10-05", dept: "sales", person: id }, TODAY, DEPTS)).toEqual({ period: "month", on: "2026-10-05", department: "sales", person: id });
  });
  it("ignores junk, unknown departments and days in the future", () => {
    expect(parseInsightParams({ period: "year", on: "nope", dept: "x", person: "y" }, TODAY, DEPTS)).toEqual({ period: "week", on: TODAY, department: null, person: null });
    expect(parseInsightParams({ on: "2026-12-01" }, TODAY, DEPTS).on).toBe(TODAY);
    expect(parseInsightParams({ on: "2026-02-30" }, TODAY, DEPTS).on).toBe(TODAY);
  });
  it("builds the shortest query", () => {
    expect(insightQuery({ period: "week", on: TODAY, department: null, person: null }, TODAY)).toBe("");
    expect(insightQuery({ period: "month", on: "2026-10-05", department: "sales", person: null }, TODAY)).toBe("period=month&on=2026-10-05&dept=sales");
  });
});

describe("scope", () => {
  const lead: Scope = { people: new Set(["a"]), departments: new Set(["sales"]), department: null, person: null };
  it("shows everything to the founder", () => {
    expect(inScope({ assignee_id: "z", department: "workshop" }, { people: null, departments: null, department: null, person: null })).toBe(true);
  });
  it("shows a lead their people and their departments' unowned work only", () => {
    expect(inScope({ assignee_id: "a", department: "workshop" }, lead)).toBe(true);
    expect(inScope({ assignee_id: "b", department: "sales" }, lead)).toBe(false);
    expect(inScope({ assignee_id: null, department: "sales" }, lead)).toBe(true);
    expect(inScope({ assignee_id: null, department: "workshop" }, lead)).toBe(false);
  });
  it("applies the department and person filters on top", () => {
    expect(inScope({ assignee_id: "a", department: "sales" }, { ...lead, department: "workshop" })).toBe(false);
    expect(inScope({ assignee_id: "a", department: "sales" }, { ...lead, person: "b" })).toBe(false);
  });
});

describe("summarize", () => {
  const rows = [
    task({ bucket: "early", done_day: "2026-11-17" }),
    task({ bucket: "on_time" }),
    task({ bucket: "late", days_late: 2, reschedules: 1, estimate_minutes: 60, logged_minutes: 90 }),
    task({ bucket: null, due_date: null, original_due_date: null }),
    task({ bucket: "late", days_late: 0, done_day: "2026-11-02" }), // outside the range
    open({ created_day: "2026-11-17" }),
  ];
  const s = summarize(rows, "2026-11-16", "2026-11-22");
  it("splits finished work and keeps no-deadline work out of the rate", () => {
    expect([s.done, s.early, s.onTime, s.late, s.noDeadline]).toEqual([4, 1, 1, 1, 1]);
    expect(s.withDeadline).toBe(3);
    expect(s.onTimeRate).toBe(67);
  });
  it("counts what was created in the range, lateness, moves and time", () => {
    expect(s.created).toBe(1);
    expect(s.avgDaysLate).toBe(2);
    expect(s.reschedules).toBe(1);
    expect(s.loggedMinutes).toBe(90);
    expect(s.estimateRatio).toBe(150);
  });
  it("has no rate when nothing had a deadline", () => {
    const x = summarize([task({ bucket: null })], "2026-11-16", "2026-11-22");
    expect(x.onTimeRate).toBeNull();
    expect(x.avgDaysLate).toBeNull();
    expect(x.estimateRatio).toBeNull();
  });
  it("compares periods", () => {
    expect(delta(10, 7)).toEqual({ diff: 3, direction: "up" });
    expect(delta(5, 5)).toEqual({ diff: 0, direction: "same" });
    expect(delta(null, 5)).toBeNull();
  });
});

describe("series", () => {
  const rows = [task({ bucket: "early", done_day: "2026-11-16" }), task({ bucket: "late", days_late: 1, done_day: "2026-11-16" }), task({ done_day: "2026-11-21", bucket: null })];
  it("gives one point per day, with the weekend marked", () => {
    const d = dailySeries(rows, "2026-11-16", "2026-11-22");
    expect(d).toHaveLength(7);
    expect(d[0]).toMatchObject({ early: 1, late: 1, done: 2 });
    expect(d[5]).toMatchObject({ weekend: true, noDeadline: 1, done: 1 });
  });
  it("lists a month week by week, clipped to the month", () => {
    const w = weekLines(rows, "2026-11-01", "2026-11-30");
    expect(w[0]?.from).toBe("2026-11-01");
    expect(w[w.length - 1]?.to).toBe("2026-11-30");
    expect(w.find((x) => x.from === "2026-11-16")?.summary.done).toBe(3);
  });
  it("draws twelve weeks of squares, with later squares scaled to the busiest day", () => {
    const h = heatmap([...rows, ...Array.from({ length: 3 }, () => task({ done_day: "2026-11-17" }))], TODAY);
    expect(h).toHaveLength(12);
    const cells = h.flatMap((w) => w.cells);
    expect(cells.find((c) => c.day === "2026-11-17")).toMatchObject({ count: 3, level: 4 });
    expect(cells.find((c) => c.day === "2026-11-16")?.level).toBe(3);
    expect(cells.find((c) => c.day === "2026-11-19")).toMatchObject({ future: true, count: 0, level: 0 });
  });
  it("averages by weekday over the working days that happened", () => {
    const p = weekdayProfile(rows, "2026-11-16", "2026-11-29");
    expect(p[0]).toMatchObject({ name: "Mon", days: 2, done: 2, avgDone: 1, late: 1, lateRate: 50 });
    expect(p).toHaveLength(5);
  });
});

describe("lateness", () => {
  it("bands late finished work by working days", () => {
    const rows = [0, 1, 2, 3, 4, 5, 9].map((d) => task({ bucket: "late", days_late: d }));
    expect(latenessBands(rows, "2026-11-16", "2026-11-22").map((b) => b.count)).toEqual([1, 1, 2, 2, 1]);
  });
  it("bands open overdue work by how long it has waited", () => {
    const rows = [
      open({ due_date: "2026-11-17" }), // Tuesday, today Wednesday: 1 working day
      open({ due_date: "2026-11-13" }), // Friday: Mon, Tue, Wed = 3
      open({ due_date: "2026-11-18" }), // today, not overdue yet
      open({ due_date: null }),
      open({ due_date: "2026-10-01" }),
    ];
    expect(overdueAge(rows, TODAY).map((b) => b.count)).toEqual([0, 1, 1, 0, 1]);
  });
});

describe("people", () => {
  const people = [{ id: "a", full_name: "Asha" }, { id: "b", full_name: "Bala" }];
  const rows = [
    task({ assignee_id: "a", bucket: "early" }),
    task({ assignee_id: "a", bucket: "late", days_late: 1, reassigns: 2 }),
    open({ assignee_id: "a", due_date: "2026-11-10" }),
    open({ assignee_id: "a", due_date: null, original_due_date: null }),
    open({ assignee_id: null }),
  ];
  it("makes a line per person, plus work with no owner", () => {
    const t = peopleTable(rows, people, "2026-11-16", "2026-11-22", TODAY);
    expect(t.map((x) => x.name)).toEqual(["Asha", "Bala", "No owner"]);
    expect(t[0]).toMatchObject({ done: 2, late: 1, onTimeRate: 50, withDeadline: 2, openNow: 2, overdueNow: 1, noDeadlineOpen: 1, reassigns: 2 });
    expect(t[1]).toMatchObject({ done: 0, onTimeRate: null, openNow: 0 });
    expect(t[2]?.openNow).toBe(1);
  });
  it("lays people out by week", () => {
    const g = peopleByWeek(rows, people, ["2026-11-09", "2026-11-16"]);
    expect(g[0]?.weeks.map((w) => w.done)).toEqual([0, 2]);
    expect(g[0]?.weeks[1]?.onTimeRate).toBe(50);
  });
});

describe("plan against actual", () => {
  it("keeps finished tasks with both an estimate and logged time", () => {
    const rows = [task({ estimate_minutes: 60, logged_minutes: 45 }), task({ estimate_minutes: 60 }), task({ logged_minutes: 30 }), open({ estimate_minutes: 10, logged_minutes: 5 })];
    expect(planVsActual(rows, "2026-11-16", "2026-11-22")).toHaveLength(1);
  });
});

describe("backlog history", () => {
  const all: Scope = { people: null, departments: null, department: null, person: null };
  const rows: BacklogRow[] = [
    { snapshot_date: "2026-11-17", department: "sales", assignee_id: "a", open_count: 5, overdue_count: 2, blocked_count: 1, no_deadline_count: 0 },
    { snapshot_date: "2026-11-17", department: "workshop", assignee_id: null, open_count: 3, overdue_count: 0, blocked_count: 0, no_deadline_count: 1 },
    { snapshot_date: "2026-11-18", department: "sales", assignee_id: "a", open_count: 4, overdue_count: 1, blocked_count: 0, no_deadline_count: 0 },
  ];
  it("adds the rows of a day and keeps the days in order", () => {
    const s = backlogSeries(rows, "2026-11-01", "2026-11-30", all);
    expect(s.map((p) => [p.day, p.open, p.overdue, p.blocked])).toEqual([["2026-11-17", 8, 2, 1], ["2026-11-18", 4, 1, 0]]);
  });
  it("applies the scope", () => {
    const s = backlogSeries(rows, "2026-11-01", "2026-11-30", { ...all, department: "workshop" });
    expect(s).toHaveLength(1);
    expect(s[0]?.open).toBe(3);
  });
});

describe("buildScope", () => {
  const visible = [{ id: "a" }, { id: "b" }];
  it("gives the founder everything and keeps their filters", () => {
    expect(buildScope({ role: "founder", departments: [] }, visible, { department: "sales", person: "z" })).toEqual({ people: null, departments: null, department: "sales", person: "z" });
  });
  it("limits a lead to their people and departments, and drops filters outside them", () => {
    const s = buildScope({ role: "dept_lead", departments: ["sales"] }, visible, { department: "workshop", person: "z" });
    expect(s.department).toBeNull();
    expect(s.person).toBeNull();
    expect(inScope({ assignee_id: "a", department: "workshop" }, s)).toBe(true);
    expect(inScope({ assignee_id: "z", department: "sales" }, s)).toBe(false);
    expect(inScope({ assignee_id: null, department: "sales" }, s)).toBe(true);
    expect(inScope({ assignee_id: null, department: "workshop" }, s)).toBe(false);
    expect(buildScope({ role: "dept_lead", departments: ["sales"] }, visible, { department: "sales", person: "b" })).toMatchObject({ department: "sales", person: "b" });
  });
});

describe("normalizeRows", () => {
  it("drops rows without the basics and fills counters with zero", () => {
    const rows = normalizeRows([
      { task_id: "x", title: "T", department: "sales", status: "done", created_day: "2026-11-10", bucket: "late" },
      { task_id: "y", title: null, department: "sales", status: "todo", created_day: "2026-11-10" },
      { task_id: "z", title: "Z", department: "sales", status: "todo", created_day: "2026-11-10", bucket: null },
    ]);
    expect(rows.map((r) => r.task_id)).toEqual(["x", "z"]);
    expect(rows[0]).toMatchObject({ bucket: "late", logged_minutes: 0, reschedules: 0, priority: 3, assignee_id: null });
    expect(rows[1]?.bucket).toBeNull();
  });
});
