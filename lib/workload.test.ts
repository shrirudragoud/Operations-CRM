import { describe, expect, it } from "vitest";
import { buildWorkload, bucketTask, groupTasks, visiblePeople } from "./workload";

const today = "2026-03-10";
const now = new Date("2026-03-10T06:00:00Z");
const t = (o: Partial<Parameters<typeof bucketTask>[0]> = {}) => ({ status: "todo", start_date: null, due_date: null, due_time: null, ...o });

describe("bucketTask", () => {
  it("sorts a task into one bucket", () => {
    expect(bucketTask(t({ due_date: "2026-03-09" }), today, now)).toBe("overdue");
    expect(bucketTask(t({ due_date: today }), today, now)).toBe("today");
    expect(bucketTask(t({ due_date: "2026-03-14" }), today, now)).toBe("soon");
    expect(bucketTask(t({ start_date: "2026-03-12", due_date: "2026-04-30" }), today, now)).toBe("soon");
    expect(bucketTask(t({ due_date: "2026-04-30" }), today, now)).toBe("later");
    expect(bucketTask(t(), today, now)).toBe("unscheduled");
  });

  it("treats a started, long task as this week's work", () => {
    expect(bucketTask(t({ start_date: "2026-03-01", due_date: "2026-04-30" }), today, now)).toBe("soon");
  });

  it("groups a list", () => {
    const g = groupTasks([t({ due_date: today }), t(), t({ due_date: "2026-03-01" })], today, now);
    expect([g.today.length, g.unscheduled.length, g.overdue.length]).toEqual([1, 1, 1]);
  });
});

describe("buildWorkload", () => {
  const people = [{ id: "a", full_name: "Asha" }, { id: "b", full_name: "Bala" }];
  it("totals open work, estimates, week minutes, health and the on-time rate", () => {
    const rows = buildWorkload({
      people,
      tasks: [
        { assignee_id: "a", status: "todo", start_date: null, due_date: "2026-03-01", due_time: null, estimate_minutes: 60 },
        { assignee_id: "a", status: "doing", start_date: null, due_date: "2026-03-12", due_time: null, estimate_minutes: null },
        { assignee_id: "a", status: "todo", start_date: null, due_date: "2026-05-01", due_time: null, estimate_minutes: 30 },
        { assignee_id: "zz", status: "todo", start_date: null, due_date: null, due_time: null, estimate_minutes: 999 },
      ],
      minutes: [{ staff_id: "a", minutes: 90 }, { staff_id: "a", minutes: 30 }, { staff_id: "b", minutes: 10 }],
      done: [
        { assignee_id: "a", due_date: "2026-03-05", completed_at: "2026-03-05T05:00:00Z" },
        { assignee_id: "a", due_date: "2026-03-05", completed_at: "2026-03-07T05:00:00Z" },
        { assignee_id: "b", due_date: null, completed_at: "2026-03-07T05:00:00Z" },
      ],
      today,
      now,
    });
    const a = rows.find((r) => r.id === "a")!;
    expect(a).toMatchObject({ open: 3, overdue: 1, dueSoon: 1, estimatedMinutes: 90, unestimated: 1, weekMinutes: 120, overloaded: false });
    expect(a.health).toMatchObject({ total: 3, overdue: 1, attention: 1 });
    expect(a.onTime).toEqual({ rate: 50, total: 2 });
    expect(rows.find((r) => r.id === "b")).toMatchObject({ open: 0, weekMinutes: 10, onTime: { rate: null, total: 0 } });
    expect(rows[0]?.id).toBe("a");
  });

  it("flags more than 40 hours of estimates", () => {
    const [r] = buildWorkload({
      people: [people[0]!],
      tasks: [{ assignee_id: "a", status: "todo", start_date: null, due_date: null, due_time: null, estimate_minutes: 2401 }],
      minutes: [], today, now,
    });
    expect(r?.overloaded).toBe(true);
  });
});

describe("visiblePeople", () => {
  const staff = [
    { id: "1", role: "member", departments: ["sales"] },
    { id: "2", role: "member", departments: ["training"] },
    { id: "3", role: "partner", departments: [] },
    { id: "4", role: "viewer", departments: ["sales"] },
  ];
  it("shows a founder every internal person and a lead only department mates", () => {
    expect(visiblePeople(staff, { role: "founder", departments: [] }).map((s) => s.id)).toEqual(["1", "2"]);
    expect(visiblePeople(staff, { role: "dept_lead", departments: ["sales"] }).map((s) => s.id)).toEqual(["1"]);
  });
});
