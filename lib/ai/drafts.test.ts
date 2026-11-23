import { describe, expect, it } from "vitest";
import { checkAssign, checkComment, checkCreateSubtasks, checkCreateTask, checkSchedule, checkStatus, checkUpdateTask, mergeEdit, summarize, type Names } from "./drafts";
import { ID, TASK_A } from "./fake-env";

const today = "2026-11-22";
const names: Names = { task: (id) => (id === ID.taskA ? '"Send the quote"' : '"a task"'), person: (id) => (id === ID.asha ? "Asha Rao" : "someone") };

describe("create drafts", () => {
  it("accepts a normal task and normalises it", () => {
    const r = checkCreateTask({ title: "  Call the school ", assignee_id: ID.asha, due_date: "2099-02-01", priority: "2" });
    expect(r).toMatchObject({ ok: true, payload: { title: "Call the school", assignee_id: ID.asha, due_date: "2099-02-01", priority: 2, mode: "separate" } });
  });
  it("refuses a past due date, a missing title and a time without a date", () => {
    expect(checkCreateTask({ title: "x", due_date: "2001-01-01" })).toMatchObject({ ok: false });
    expect(checkCreateTask({ due_date: "2099-01-01" })).toMatchObject({ ok: false });
    expect(checkCreateTask({ title: "x", due_time: "10:00" })).toMatchObject({ ok: false });
  });
  it("validates every subtask and names the broken one", () => {
    const bad = checkCreateSubtasks({ parent_task_id: ID.taskA, subtasks: [{ title: "ok" }, { title: "" }] });
    expect(bad).toMatchObject({ ok: false });
    expect((bad as { errors: string[] }).errors.join()).toContain("subtask 2");
    expect(checkCreateSubtasks({ parent_task_id: ID.taskA, subtasks: [] })).toMatchObject({ ok: false });
    expect(checkCreateSubtasks({ parent_task_id: "nope", subtasks: [{ title: "a" }] })).toMatchObject({ ok: false });
    const ok = checkCreateSubtasks({ parent_task_id: ID.taskA, subtasks: [{ title: "a" }, { title: "b", assignee_id: ID.asha }] });
    expect(ok).toMatchObject({ ok: true });
    expect((ok as unknown as { payload: { subtasks: unknown[] } }).payload.subtasks).toHaveLength(2);
  });
  it("caps subtasks at 15", () => {
    const many = Array.from({ length: 16 }, (_, i) => ({ title: `s${i}` }));
    expect(checkCreateSubtasks({ parent_task_id: ID.taskA, subtasks: many })).toMatchObject({ ok: false });
  });
});

describe("edit drafts keep only what changes", () => {
  it("update_task stores just the changed fields", () => {
    const r = checkUpdateTask(TASK_A, { title: "Send the revised quote", unrelated: 1 });
    expect(r).toEqual({ ok: true, payload: { id: ID.taskA, changes: { title: "Send the revised quote" } } });
  });
  it("an empty string clears a field", () => {
    expect(checkUpdateTask(TASK_A, { description: "" })).toEqual({ ok: true, payload: { id: ID.taskA, changes: { description: null } } });
  });
  it("update_task with nothing to change is refused", () => {
    expect(checkUpdateTask(TASK_A, {})).toMatchObject({ ok: false });
    expect(checkUpdateTask(TASK_A, { title: "   " })).toMatchObject({ ok: false });
  });
  it("set_schedule validates against the live task and refuses a past date", () => {
    expect(checkSchedule(TASK_A, { due_date: "2099-03-03" }, today)).toEqual({ ok: true, payload: { id: ID.taskA, changes: { due_date: "2099-03-03" } } });
    expect(checkSchedule(TASK_A, { due_date: "2026-11-01" }, today)).toMatchObject({ ok: false });
    expect(checkSchedule({ ...TASK_A, due_date: null, due_time: null }, { due_time: "10:00" }, today)).toMatchObject({ ok: false });
    expect(checkSchedule(TASK_A, { start_date: "2099-02-01", due_date: "2099-01-20" }, today)).toMatchObject({ ok: false });
    expect(checkSchedule(TASK_A, { due_date: "" }, today)).toMatchObject({ ok: false });
    expect(checkSchedule(TASK_A, { due_date: "", due_time: "" }, today)).toEqual({ ok: true, payload: { id: ID.taskA, changes: { due_date: null, due_time: null } } });
  });
  it("mergeEdit lays the changes over the live task, so newer edits survive", () => {
    const live = { ...TASK_A, title: "Edited by someone else", priority: 1 };
    const input = mergeEdit("set_schedule", live, { due_date: "2099-05-05" });
    expect(input).toEqual({ id: ID.taskA, start_date: null, due_date: "2099-05-05", due_time: "17:00", priority: 1, estimate_minutes: null });
    expect(mergeEdit("update_task", live, { description: null })).toMatchObject({ title: "Edited by someone else", description: null, priority: 1 });
  });
});

describe("status, assign, comment", () => {
  it("follows the allowed moves and requires reasons", () => {
    expect(checkStatus(TASK_A, { id: ID.taskA, status: "doing" })).toMatchObject({ ok: true });
    expect(checkStatus(TASK_A, { id: ID.taskA, status: "todo" })).toMatchObject({ ok: false });
    expect(checkStatus(TASK_A, { id: ID.taskA, status: "blocked" })).toMatchObject({ ok: false });
    expect(checkStatus(TASK_A, { id: ID.taskA, status: "blocked", reason: "Waiting for PO" })).toMatchObject({ ok: true });
    expect(checkStatus({ ...TASK_A, status: "done" }, { id: ID.taskA, status: "blocked", reason: "x" })).toMatchObject({ ok: false });
    expect(checkStatus({ ...TASK_A, status: "done" }, { id: ID.taskA, status: "doing" })).toMatchObject({ ok: true });
  });
  it("assigns, releases to the queue and comments", () => {
    expect(checkAssign({ id: ID.taskA, assignee_id: ID.asha })).toMatchObject({ ok: true, payload: { assignee_id: ID.asha } });
    expect(checkAssign({ id: ID.taskA, assignee_id: null })).toMatchObject({ ok: true, payload: { assignee_id: null } });
    expect(checkAssign({ id: "x" })).toMatchObject({ ok: false });
    expect(checkComment({ task_id: ID.taskA, body: "  hello ", mentions: [ID.asha] })).toMatchObject({ ok: true, payload: { body: "hello", mentions: [ID.asha] } });
    expect(checkComment({ task_id: ID.taskA, body: "  " })).toMatchObject({ ok: false });
  });
});

describe("summaries", () => {
  it("reads like a sentence and stays under the database limit", () => {
    expect(summarize("create_task", { title: "Call school", assignee_id: ID.asha, due_date: "2099-02-01", priority: 1 }, names)).toBe('Create the task "Call school" (for Asha Rao, due 1 Feb, Urgent priority)');
    expect(summarize("assign_task", { id: ID.taskA, assignee_id: null }, names)).toContain("team queue");
    expect(summarize("change_status", { id: ID.taskA, status: "blocked", reason: "PO" }, names)).toBe('Mark "Send the quote" as Blocked: PO');
    expect(summarize("set_schedule", { id: ID.taskA, changes: { due_date: "2099-03-03", priority: 2 } }, names)).toBe('Set due date to 3 Mar, priority to High on "Send the quote"');
    const long = summarize("create_subtasks", { parent_task_id: ID.taskA, subtasks: Array.from({ length: 15 }, () => ({ title: "x".repeat(200) })) }, names);
    expect(long.length).toBeLessThanOrEqual(600);
  });
});
