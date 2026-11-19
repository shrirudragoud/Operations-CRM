import { describe, expect, it } from "vitest";
import { taskCalendarItems, type CalendarTask } from "./task-calendar";

const NOW = new Date("2026-11-10T04:30:00Z");
const win = { fromDay: "2026-11-01", toDay: "2026-12-01", now: NOW };
const task = (o: Partial<CalendarTask> = {}): CalendarTask => ({
  id: "t1", title: "Ship it", department: null, status: "todo", due_date: "2026-11-12", due_time: null, start_date: null, ...o,
});
const keys = (t: CalendarTask, w = win) => taskCalendarItems(t, w).map((i) => i.key);

describe("taskCalendarItems", () => {
  it("shows the deadline and a reminder on each remaining day before it", () => {
    expect(keys(task())).toEqual(["t:t1", "t:t1:r:2026-11-10", "t:t1:r:2026-11-11"]);
    const items = taskCalendarItems(task(), win);
    expect(items[0]).toMatchObject({ reminder: false, when: "Due" });
    expect(items.find((i) => i.key.endsWith("2026-11-11"))).toMatchObject({ reminder: true, when: "Due tomorrow" });
    expect(items.find((i) => i.key.endsWith("2026-11-10"))).toMatchObject({ when: "Due in 2 days" });
  });

  it("does not put a reminder on a day that has already passed", () => {
    expect(keys(task({ due_date: "2026-11-11" }))).toEqual(["t:t1", "t:t1:r:2026-11-10"]);
    expect(keys(task({ due_date: "2026-11-10" }))).toEqual(["t:t1"]);
  });

  it("gives a reminder only to open work", () => {
    expect(keys(task({ status: "done" }))).toEqual(["t:t1"]);
    expect(keys(task({ status: "cancelled" }))).toEqual(["t:t1"]);
    expect(keys(task({ status: "doing" })).length).toBe(3);
    expect(keys(task({ status: "blocked" })).length).toBe(3);
  });

  it("carries an overdue task onto today", () => {
    const items = taskCalendarItems(task({ due_date: "2026-11-07" }), win);
    expect(items.map((i) => i.key)).toEqual(["t:t1", "t:t1:c"]);
    expect(items[1]).toMatchObject({ reminder: true, when: "Was due 7 Nov 2026" });
    expect(items[1]?.health?.label).toBe("Overdue 3 d");
    expect(items[1]?.starts_at.startsWith("2026-11-09T18:30")).toBe(true);
  });

  it("does not carry a finished overdue task forward", () => {
    expect(keys(task({ due_date: "2026-11-07", status: "done" }))).toEqual(["t:t1"]);
  });

  it("clips to the window", () => {
    expect(keys(task(), { ...win, fromDay: "2026-11-11", toDay: "2026-11-12" })).toEqual(["t:t1:r:2026-11-11"]);
    expect(keys(task(), { ...win, fromDay: "2026-11-12", toDay: "2026-11-13" })).toEqual(["t:t1"]);
  });

  it("ignores a task without a deadline", () => {
    expect(keys(task({ due_date: null }))).toEqual([]);
  });

  it("colours the lead-up: calmer further out, louder near the deadline", () => {
    const items = taskCalendarItems(task({ status: "doing", updated_at: NOW.toISOString(), accepted_at: NOW.toISOString() }), win);
    const tone = (day: string) => items.find((i) => i.key.endsWith(day))?.health?.tone;
    expect(tone("2026-11-10")).toBe("amber");
    expect(tone("2026-11-11")).toBe("orange");
  });
});
