import { describe, expect, it } from "vitest";
import { toChatMessages, toDraftCard } from "./thread";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const row = (id: string, role: string, content: unknown) => ({ id, role, content, created_at: "2026-11-22T10:00:00Z" });

describe("toChatMessages", () => {
  it("shows only what the person said and the assistant answered", () => {
    const out = toChatMessages([
      row("1", "user", { parts: [{ text: "who is late?" }] }),
      row("2", "model", { parts: [{ text: "hmm", thought: true }, { functionCall: { name: "search_tasks", args: {} } }] }),
      row("3", "tool", { parts: [{ functionResponse: { name: "search_tasks", response: {} } }] }),
      row("4", "model", { parts: [{ text: "thinking", thought: true }, { text: "Two tasks." }], drafts: ["d1", 5] }),
      row("5", "model", { parts: [{ text: "Sorry." }], error: true }),
    ]);
    expect(out.map((m) => [m.id, m.role, m.text])).toEqual([["1", "user", "who is late?"], ["4", "model", "Two tasks."], ["5", "model", "Sorry."]]);
    expect(out[1]?.draftIds).toEqual(["d1"]);
    expect(out[2]?.error).toBe(true);
  });

  it("copes with odd stored content", () => {
    expect(toChatMessages([row("1", "user", null), row("2", "model", { parts: [] })]).map((m) => m.id)).toEqual(["2"]);
  });
});

describe("toDraftCard", () => {
  const base = { id: "d", kind: "create_task", summary: "s", status: "pending", payload: {}, result: null, error: null, expires_at: "2026-11-23T10:00:00Z" };
  const now = Date.parse("2026-11-22T10:00:00Z");

  it("marks an old pending draft as expired, but not a finished one", () => {
    expect(toDraftCard(base, Date.parse("2026-11-24T00:00:00Z")).expired).toBe(true);
    expect(toDraftCard({ ...base, status: "done" }, Date.parse("2026-11-24T00:00:00Z")).expired).toBe(false);
    expect(toDraftCard(base, now).expired).toBe(false);
  });

  it("lays a new task out field by field, with names for the people", () => {
    const card = toDraftCard({ ...base, payload: { title: "Fix cards", assignee_id: T1, due_date: "2099-02-01", priority: 2, department: "sales", description: "  " } }, now, new Map([[T1, "Asha Rao"]]));
    expect(card.task).toMatchObject({ title: "Fix cards", assignees: ["Asha Rao"], priority: 2, department: "sales", description: null, shared: false });
    expect(card.task?.dueLabel).toContain("Feb");
    expect(toDraftCard({ ...base, payload: { title: "x" } }, now).task).toMatchObject({ assignees: [], dueLabel: null, priority: 3 });
    expect(toDraftCard({ ...base, kind: "add_comment" }, now).task).toBeNull();
  });

  it("collects the tasks a draft touched, never comment ids", () => {
    expect(toDraftCard({ ...base, kind: "create_subtasks", result: { created: { "0": T1, "1": T2 } }, payload: { parent_task_id: T2 } }, now).taskIds.sort()).toEqual([T1, T2]);
    expect(toDraftCard({ ...base, kind: "add_comment", payload: { task_id: T1 }, result: { comment_id: T2 } }, now).taskIds).toEqual([T1]);
    expect(toDraftCard({ ...base, payload: { id: "not-a-uuid" } }, now).taskIds).toEqual([]);
  });
});
