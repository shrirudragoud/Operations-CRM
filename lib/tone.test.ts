import { describe, expect, it } from "vitest";
import { dueState } from "@/lib/tone";

describe("dueState", () => {
  const today = "2026-03-10";
  it("is red when overdue, amber today, blue within 3 days, grey later", () => {
    expect(dueState({ status: "todo", due_date: "2026-03-09" }, today, true)).toBe("overdue");
    expect(dueState({ status: "todo", due_date: today }, today, false)).toBe("today");
    expect(dueState({ status: "todo", due_date: "2026-03-13" }, today, false)).toBe("soon");
    expect(dueState({ status: "todo", due_date: "2026-03-14" }, today, false)).toBe("later");
  });
  it("has no urgency without a date or once finished", () => {
    expect(dueState({ status: "todo", due_date: null }, today, false)).toBe("none");
    expect(dueState({ status: "done", due_date: "2026-03-01" }, today, true)).toBe("none");
  });
});
