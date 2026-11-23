import { describe, expect, it } from "vitest";
import { onTimeRate, subtaskRollup, summarizeHealth, taskHealth, type HealthTask } from "./task-health";

// 10 Nov 2026, 10:00 IST.
const NOW = new Date("2026-11-10T04:30:00Z");
const t = (over: Partial<HealthTask>): HealthTask => ({ status: "doing", due_date: null, ...over });

describe("taskHealth: the lead-up to a deadline on the 12th", () => {
  it("is quiet more than three days out", () => {
    const h = taskHealth(t({ status: "todo", due_date: "2026-11-15" }), NOW);
    expect(h.key).toBe("later");
    expect(h.level).toBe(0);
  });

  it("goes blue three days out, amber two days out, orange the day before and on the day", () => {
    const d = (due: string) => taskHealth(t({ due_date: due, updated_at: NOW.toISOString() }), NOW);
    expect(d("2026-11-13")).toMatchObject({ key: "soon", tone: "blue", label: "Due in 3 days", level: 1 });
    expect(d("2026-11-12")).toMatchObject({ key: "soon", tone: "amber", label: "Due in 2 days" });
    expect(d("2026-11-11")).toMatchObject({ key: "soon", tone: "orange", label: "Due tomorrow" });
    expect(d("2026-11-10")).toMatchObject({ key: "due_today", tone: "orange", label: "Due today", level: 2 });
  });

  it("turns red once late, counting days", () => {
    expect(taskHealth(t({ due_date: "2026-11-08" }), NOW)).toMatchObject({ key: "overdue", tone: "red", label: "Overdue 2 d", level: 3, daysLeft: -2 });
    expect(taskHealth(t({ due_date: "2026-11-09" }), NOW).label).toBe("Overdue 1 d");
  });

  it("is overdue today once the due time has passed, and not before", () => {
    expect(taskHealth(t({ due_date: "2026-11-10", due_time: "09:00" }), NOW)).toMatchObject({ key: "overdue", label: "Overdue today" });
    expect(taskHealth(t({ due_date: "2026-11-10", due_time: "17:00" }), NOW).key).toBe("due_today");
  });

  it("ranks later tasks lower than sooner ones and late ones highest", () => {
    const rank = (due: string) => taskHealth(t({ due_date: due, updated_at: NOW.toISOString() }), NOW).rank;
    expect(rank("2026-11-08")).toBeGreaterThan(rank("2026-11-10"));
    expect(rank("2026-11-10")).toBeGreaterThan(rank("2026-11-11"));
    expect(rank("2026-11-11")).toBeGreaterThan(rank("2026-11-13"));
  });
});

describe("taskHealth: at risk", () => {
  it("flags a to-do that is not started with two days left", () => {
    const h = taskHealth(t({ status: "todo", due_date: "2026-11-12" }), NOW);
    expect(h).toMatchObject({ key: "at_risk", tone: "orange", level: 2, label: "At risk · in 2 days" });
    expect(h.reasons).toContain("Not started");
    expect(h.detail).toContain("Not started");
  });

  it("flags blocked work three days out in amber", () => {
    const h = taskHealth(t({ status: "blocked", due_date: "2026-11-13" }), NOW);
    expect(h).toMatchObject({ key: "at_risk", tone: "amber" });
    expect(h.reasons).toEqual(["Blocked"]);
  });

  it("flags a task assigned to someone who has not accepted it", () => {
    const h = taskHealth(t({ status: "todo", due_date: "2026-11-13", assignee_id: "a", accepted_at: null }), NOW);
    expect(h.reasons).toContain("Not accepted yet");
  });

  it("skips the accepted check when accepted_at was not loaded", () => {
    const h = taskHealth(t({ status: "todo", due_date: "2026-11-13", assignee_id: "a" }), NOW);
    expect(h.key).toBe("soon");
  });

  it("flags an estimate that does not fit the working days left", () => {
    const h = taskHealth(t({ status: "todo", due_date: "2026-11-13", estimate_minutes: 30 * 60 }), NOW);
    expect(h.key).toBe("at_risk");
    expect(h.reasons.join(" ")).toMatch(/Needs about 30 h but only 4 working days left/);
  });

  it("does not count Sundays as working days", () => {
    // 2026-11-13 is a Friday. Due Monday 16th: Tue 10 .. Mon 16 is 7 days, one Sunday, so 6 working days.
    const h = taskHealth(t({ status: "todo", due_date: "2026-11-16", estimate_minutes: 40 * 60 }), NOW);
    expect(h.key).toBe("later");
    const near = taskHealth(t({ status: "todo", due_date: "2026-11-13", estimate_minutes: 24 * 60 + 1 }), NOW);
    expect(near.reasons.join(" ")).toMatch(/4 working days/);
  });

  it("flags open subtasks on the last day", () => {
    const h = taskHealth(t({ due_date: "2026-11-11", subOpen: 2, updated_at: NOW.toISOString() }), NOW);
    expect(h.key).toBe("at_risk");
    expect(h.reasons).toContain("2 subtasks still open");
    expect(taskHealth(t({ due_date: "2026-11-12", subOpen: 2, updated_at: NOW.toISOString() }), NOW).key).toBe("soon");
  });

  it("flags work in progress that nobody has touched for three days", () => {
    const h = taskHealth(t({ due_date: "2026-11-12", updated_at: "2026-11-06T05:00:00Z" }), NOW);
    expect(h.key).toBe("at_risk");
    expect(h.reasons).toContain("No update for 4 days");
  });

  it("flags a to-do that is past half of its start to deadline span", () => {
    const h = taskHealth(t({ status: "todo", start_date: "2026-11-01", due_date: "2026-11-13" }), NOW);
    expect(h.reasons).toContain("Half the time is gone and it has not started");
  });

  it("does not flag an active task with nothing wrong", () => {
    expect(taskHealth(t({ due_date: "2026-11-12", updated_at: NOW.toISOString() }), NOW).key).toBe("soon");
  });
});

describe("taskHealth: roll-up from subtasks", () => {
  it("puts a parent that is due in ten days at risk when a subtask is overdue", () => {
    const h = taskHealth(t({ due_date: "2026-11-20", subOverdue: 2 }), NOW);
    expect(h).toMatchObject({ key: "at_risk", level: 2, tone: "amber", label: "At risk · in 10 days" });
    expect(h.reasons).toEqual(["2 subtasks overdue"]);
  });

  it("names a single blocked subtask in the singular", () => {
    const h = taskHealth(t({ due_date: "2026-11-20", subBlocked: 1 }), NOW);
    expect(h.key).toBe("at_risk");
    expect(h.reasons).toEqual(["1 subtask blocked"]);
  });

  it("adds the roll-up to the reasons already found near the deadline", () => {
    const h = taskHealth(t({ status: "todo", due_date: "2026-11-11", subOverdue: 1, subBlocked: 1 }), NOW);
    expect(h.key).toBe("at_risk");
    expect(h.reasons).toEqual(expect.arrayContaining(["Not started", "1 subtask overdue", "1 subtask blocked"]));
  });

  it("keeps a late parent red and lists the subtasks in the reason", () => {
    const h = taskHealth(t({ due_date: "2026-11-08", subOverdue: 3 }), NOW);
    expect(h).toMatchObject({ key: "overdue", level: 3 });
    expect(h.reasons).toEqual(["3 subtasks overdue"]);
  });

  it("flags a parent with no deadline when a subtask is late, and stays quiet otherwise", () => {
    expect(taskHealth(t({ due_date: null, subOverdue: 1 }), NOW)).toMatchObject({ key: "at_risk", reasons: ["1 subtask overdue"] });
    expect(taskHealth(t({ due_date: null }), NOW).key).toBe("no_date");
  });

  it("ignores subtask trouble once the parent is finished", () => {
    expect(taskHealth(t({ status: "done", due_date: "2026-11-20", subOverdue: 1 }), NOW).key).toBe("finished");
  });

  it("counts open, overdue and blocked subtasks and skips finished ones", () => {
    const subs = [
      { status: "todo", due_date: "2026-11-09" },
      { status: "blocked", due_date: "2026-11-30" },
      { status: "doing", due_date: "2026-11-10", due_time: "09:00" },
      { status: "doing", due_date: "2026-11-10", due_time: "17:00" },
      { status: "done", due_date: "2026-11-01" },
      { status: "cancelled", due_date: "2026-11-01" },
    ];
    expect(subtaskRollup(subs, NOW)).toEqual({ subOpen: 4, subOverdue: 2, subBlocked: 1 });
  });
});

describe("taskHealth: the rest", () => {
  it("shows on track for work in progress that is not due soon", () => {
    expect(taskHealth(t({ due_date: "2026-11-20" }), NOW)).toMatchObject({ key: "on_track", tone: "green" });
  });

  it("handles no deadline and finished work", () => {
    expect(taskHealth(t({}), NOW).key).toBe("no_date");
    expect(taskHealth(t({ status: "done", due_date: "2026-11-01" }), NOW)).toMatchObject({ key: "finished", tone: "green", level: 0 });
    expect(taskHealth(t({ status: "cancelled", due_date: "2026-11-01" }), NOW).key).toBe("finished");
  });
});

describe("summarizeHealth", () => {
  it("counts open tasks by health and ignores finished ones", () => {
    const s = summarizeHealth(
      [
        t({ due_date: "2026-11-01" }),
        t({ status: "todo", due_date: "2026-11-11" }),
        t({ status: "todo", due_date: "2026-11-30" }),
        t({ due_date: "2026-11-30" }),
        t({}),
        t({ status: "done", due_date: "2026-11-01" }),
      ],
      NOW,
    );
    expect(s).toMatchObject({ total: 5, overdue: 1, atRisk: 1, later: 1, onTrack: 1, noDate: 1, attention: 2 });
  });
});

describe("onTimeRate", () => {
  it("compares the IST completion day to the deadline day", () => {
    const r = onTimeRate([
      { due_date: "2026-11-10", completed_at: "2026-11-10T18:00:00Z" },
      { due_date: "2026-11-10", completed_at: "2026-11-10T20:00:00Z" },
      { due_date: "2026-11-10", completed_at: "2026-11-09T08:00:00Z" },
      { due_date: null, completed_at: "2026-11-09T08:00:00Z" },
    ]);
    expect(r).toEqual({ onTime: 2, late: 1, total: 3, rate: 67 });
  });

  it("is null when nothing counts", () => {
    expect(onTimeRate([]).rate).toBeNull();
  });
});
