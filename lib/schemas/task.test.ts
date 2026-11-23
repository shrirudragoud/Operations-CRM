import { describe, expect, it } from "vitest";
import {
  allowedTaskMoves, createTaskSchema, describeHistory, describeRecurrence, formatDue, formatMinutes, formatSpan, isOverdue,
  parseTaskParams, recurrenceSchema, scheduleTaskSchema, taskCommentSchema, taskQuery, taskStatusSchema, updateTaskSchema,
} from "./task";

const UUID = "00000000-0000-4000-8000-000000000001";
const FUTURE = "2099-01-01";

describe("createTaskSchema", () => {
  it("accepts a minimal task and fills the defaults", () => {
    const r = createTaskSchema.parse({ title: "  Call the principal  ", department: "sales" });
    expect(r).toMatchObject({ title: "Call the principal", department: "sales", priority: 3, assignee_id: null, due_date: null, due_time: null, estimate_minutes: null });
  });
  it("needs a title, and a department is optional but must be a real one", () => {
    expect(createTaskSchema.safeParse({ title: "   ", department: "sales" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", department: "legal" }).success).toBe(false);
  });
  it("takes no department or category, an Internal or Others category, and several people", () => {
    expect(createTaskSchema.parse({ title: "x" })).toMatchObject({ department: null, category: null, also_assignee_ids: [] });
    expect(createTaskSchema.parse({ title: "x", department: "", category: "" })).toMatchObject({ department: null, category: null });
    expect(createTaskSchema.parse({ title: "x", category: "internal" }).category).toBe("internal");
    expect(createTaskSchema.parse({ title: "x", category: "other" }).category).toBe("other");
    expect(createTaskSchema.safeParse({ title: "x", category: "sales" }).success).toBe(false);
    const ids = Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(createTaskSchema.safeParse({ title: "x", also_assignee_ids: ids }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: "x", also_assignee_ids: [...ids, "00000000-0000-4000-8000-0000000000ff"] }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", also_assignee_ids: ids.slice(0, 2), parent_task_id: ids[5] }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: "x", also_assignee_ids: ids.slice(0, 2), entity_type: "deal", entity_id: ids[5] }).success).toBe(false);
  });
  it("turns empty form strings into nulls", () => {
    const r = createTaskSchema.parse({ title: "x", department: "sales", assignee_id: "", due_date: "", due_time: "", description: "", estimate_minutes: "", parent_task_id: "" });
    expect(r).toMatchObject({ assignee_id: null, due_date: null, due_time: null, description: null, estimate_minutes: null, parent_task_id: null });
  });
  it("needs a date for a due time and refuses a past date", () => {
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", due_time: "10:30" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", due_date: FUTURE, due_time: "10:30" }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", due_date: "2001-01-01" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", due_date: FUTURE, due_time: "25:00" }).success).toBe(false);
  });
  it("validates priority and estimate", () => {
    expect(createTaskSchema.parse({ title: "x", department: "sales", priority: "2" }).priority).toBe(2);
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", priority: 9 }).success).toBe(false);
    expect(createTaskSchema.parse({ title: "x", department: "sales", estimate_minutes: "90" }).estimate_minutes).toBe(90);
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", estimate_minutes: "0" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", estimate_minutes: "1.5" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", estimate_minutes: 6001 }).success).toBe(false);
  });
  it("links a record only when both parts are given", () => {
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", entity_type: "institution" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", entity_type: "institution", entity_id: UUID }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", entity_type: "invoice", entity_id: UUID }).success).toBe(false);
  });
  it("limits the title and description length", () => {
    expect(createTaskSchema.safeParse({ title: "x".repeat(201), department: "sales" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", description: "d".repeat(4001) }).success).toBe(false);
  });
});

describe("updateTaskSchema and scheduleTaskSchema", () => {
  it("requires an id and allows a past date when editing", () => {
    expect(updateTaskSchema.safeParse({ title: "x", department: "sales" }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ id: UUID, title: "x", department: "sales", due_date: "2001-01-01" }).success).toBe(true);
  });
  it("keeps the due-time-needs-date rule", () => {
    expect(scheduleTaskSchema.safeParse({ id: UUID, due_time: "09:00" }).success).toBe(false);
    expect(scheduleTaskSchema.safeParse({ id: UUID, due_date: FUTURE, due_time: "09:00", priority: 1 }).success).toBe(true);
  });
});

describe("taskStatusSchema", () => {
  it("needs a reason for blocked and cancelled only", () => {
    expect(taskStatusSchema.safeParse({ id: UUID, status: "blocked" }).success).toBe(false);
    expect(taskStatusSchema.safeParse({ id: UUID, status: "blocked", reason: "  " }).success).toBe(false);
    expect(taskStatusSchema.safeParse({ id: UUID, status: "cancelled", reason: "Duplicate" }).success).toBe(true);
    expect(taskStatusSchema.safeParse({ id: UUID, status: "done" }).success).toBe(true);
    expect(taskStatusSchema.safeParse({ id: UUID, status: "finished" }).success).toBe(false);
  });
});

describe("taskCommentSchema", () => {
  it("trims and refuses blank or huge comments", () => {
    expect(taskCommentSchema.parse({ task_id: UUID, body: "  hi  " }).body).toBe("hi");
    expect(taskCommentSchema.safeParse({ task_id: UUID, body: "   " }).success).toBe(false);
    expect(taskCommentSchema.safeParse({ task_id: UUID, body: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("allowedTaskMoves", () => {
  it("mirrors the database status path", () => {
    expect(allowedTaskMoves("todo")).toContain("done");
    expect(allowedTaskMoves("done")).toEqual(["todo", "doing"]);
    expect(allowedTaskMoves("cancelled")).toEqual(["todo"]);
    expect(allowedTaskMoves("blocked")).not.toContain("blocked");
  });
});

describe("isOverdue (India time)", () => {
  // 2026-03-10 10:00 IST = 04:30 UTC
  const now = new Date("2026-03-10T04:30:00Z");
  it("is overdue when the date has passed and the task is open", () => {
    expect(isOverdue({ status: "todo", due_date: "2026-03-09", due_time: null }, now)).toBe(true);
    expect(isOverdue({ status: "done", due_date: "2026-03-09", due_time: null }, now)).toBe(false);
    expect(isOverdue({ status: "todo", due_date: null, due_time: null }, now)).toBe(false);
  });
  it("is not overdue on the due day unless the time has passed", () => {
    expect(isOverdue({ status: "doing", due_date: "2026-03-10", due_time: null }, now)).toBe(false);
    expect(isOverdue({ status: "doing", due_date: "2026-03-10", due_time: "09:30:00" }, now)).toBe(true);
    expect(isOverdue({ status: "doing", due_date: "2026-03-10", due_time: "10:30" }, now)).toBe(false);
    expect(isOverdue({ status: "doing", due_date: "2026-03-11", due_time: "00:10" }, now)).toBe(false);
  });
});

describe("formatters", () => {
  it("formats due and minutes", () => {
    expect(formatDue(null, null)).toBe("No due date");
    expect(formatDue("2026-03-10", "14:05:00")).toMatch(/10 Mar, 2:05 pm/);
    expect(formatDue("2026-03-10", "00:30")).toMatch(/12:30 am/);
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(null)).toBe("-");
  });
});

describe("parseTaskParams / taskQuery", () => {
  it("falls back to safe defaults", () => {
    expect(parseTaskParams({ tab: "evil", view: "x", department: "legal", assignee: "nope", page: "-3" })).toEqual({
      tab: "mine", view: "open", department: "", assignee: "", q: "", layout: "board", at: "", subtasks: false, page: 1,
    });
  });
  it("round-trips valid params and omits defaults", () => {
    const p = parseTaskParams({ tab: "team", view: "done", department: "sales", assignee: "none", q: "brochure", page: "2" });
    expect(p).toEqual({ tab: "team", view: "done", department: "sales", assignee: "none", q: "brochure", layout: "board", at: "", subtasks: false, page: 2 });
    expect(taskQuery(p)).toBe("tab=team&view=done&department=sales&assignee=none&q=brochure&page=2");
    expect(taskQuery({ ...p, subtasks: true, page: 1 })).toContain("subtasks=1");
    expect(parseTaskParams({ subtasks: "1" }).subtasks).toBe(true);
    expect(taskQuery({ tab: "mine", view: "open", page: 1 })).toBe("");
  });
});

describe("describeHistory", () => {
  it("words each kind", () => {
    expect(describeHistory({ kind: "created", from_value: null, to_value: null, note: null })).toBe("created the task");
    expect(describeHistory({ kind: "assigned", from_value: null, to_value: "Asha", note: null })).toBe("assigned it to Asha");
    expect(describeHistory({ kind: "assigned", from_value: "Asha", to_value: "Ravi", note: null })).toBe("reassigned it from Asha to Ravi");
    expect(describeHistory({ kind: "assigned", from_value: "Asha", to_value: null, note: null })).toBe("moved it back to the team queue (was Asha)");
    expect(describeHistory({ kind: "status", from_value: "doing", to_value: "blocked", note: "Waiting" })).toBe("changed the status from In progress to Blocked: Waiting");
    expect(describeHistory({ kind: "priority", from_value: "3", to_value: "1", note: null })).toBe("changed the priority from Normal to Urgent");
    expect(describeHistory({ kind: "due", from_value: null, to_value: "2026-03-10 09:00", note: null })).toBe("changed the deadline from none to 2026-03-10 09:00");
    expect(describeHistory({ kind: "file_added", from_value: null, to_value: "plan.pdf", note: null })).toBe("added the file plan.pdf");
    expect(describeHistory({ kind: "file_removed", from_value: "plan.pdf", to_value: null, note: null })).toBe("removed the file plan.pdf");
    expect(describeHistory({ kind: "file_restored", from_value: null, to_value: "plan.pdf", note: null })).toBe("restored the file plan.pdf");
  });
});

describe("start date", () => {
  it("rejects a start after the deadline", () => {
    const r = createTaskSchema.safeParse({ title: "x", department: "sales", start_date: "2099-02-01", due_date: "2099-01-01" });
    expect(r.success).toBe(false);
  });
  it("accepts a start on or before the deadline", () => {
    expect(createTaskSchema.safeParse({ title: "x", department: "sales", start_date: "2099-01-01", due_date: "2099-01-01" }).success).toBe(true);
  });
  it("words the span", () => {
    expect(formatSpan(null, null, null)).toBe("No due date");
    expect(formatSpan("2099-03-05", null, null)).toBe("From 5 Mar");
    expect(formatSpan("2099-03-05", "2099-03-09", null)).toBe("5 Mar to 9 Mar");
    expect(formatSpan("2099-03-09", "2099-03-09", null)).toBe("9 Mar");
  });
  it("words a start change in the history", () => {
    expect(describeHistory({ kind: "start", from_value: null, to_value: "2026-03-10", note: null })).toBe("changed the start date from none to 2026-03-10");
  });
});

describe("layout params", () => {
  it("defaults to the board and keeps it out of the URL", () => {
    expect(parseTaskParams({}).layout).toBe("board");
    expect(taskQuery({ layout: "board" })).toBe("");
  });
  it("round-trips table, calendar and timeline", () => {
    expect(parseTaskParams({ layout: "list" }).layout).toBe("list");
    expect(taskQuery({ layout: "list" })).toBe("layout=list");
    expect(taskQuery({ layout: "calendar", at: "2026-03" })).toContain("layout=calendar");
    expect(parseTaskParams({ layout: "nonsense" }).layout).toBe("board");
  });
});

describe("recurrenceSchema", () => {
  const base = { title: "Daily log", department: "workshop", frequency: "daily", starts_on: "2026-03-02", all_department: true };
  it("accepts a daily template for the whole department", () => {
    expect(recurrenceSchema.safeParse(base).success).toBe(true);
  });
  it("needs a weekday for weekly and a day for monthly", () => {
    expect(recurrenceSchema.safeParse({ ...base, frequency: "weekly" }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ ...base, frequency: "weekly", weekday: 2 }).success).toBe(true);
    expect(recurrenceSchema.safeParse({ ...base, frequency: "monthly" }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ ...base, frequency: "monthly", month_day: 29 }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ ...base, frequency: "monthly", month_day: 28 }).success).toBe(true);
  });
  it("needs people or the whole department", () => {
    expect(recurrenceSchema.safeParse({ ...base, all_department: false }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ ...base, all_department: false, staff_ids: [UUID] }).success).toBe(true);
  });
  it("rejects an end before the start", () => {
    expect(recurrenceSchema.safeParse({ ...base, ends_on: "2026-03-01" }).success).toBe(false);
  });
  it("describes itself", () => {
    expect(describeRecurrence({ frequency: "weekly", weekday: 1, month_day: null, due_after_days: 2 })).toBe("Every Monday, due 2 days later");
    expect(describeRecurrence({ frequency: "monthly", weekday: null, month_day: 5, due_after_days: 0 })).toBe("On day 5 of every month, due the same day");
  });
});
