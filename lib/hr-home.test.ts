import { describe, expect, it } from "vitest";
import { actionDetail, daysBetween, groupOverview, inDaysLabel, waitLabel } from "./hr-home";

describe("daysBetween", () => {
  it("counts calendar days across a month end", () => {
    expect(daysBetween("2026-11-28", "2026-12-02")).toBe(4);
    expect(daysBetween("2026-12-02", "2026-11-28")).toBe(-4);
  });
});

describe("waitLabel", () => {
  const today = "2026-11-20";
  it("says how long something has been waiting, in India time", () => {
    expect(waitLabel({ kind: "request", since: "2026-11-17T05:00:00Z", due_on: null }, today)).toBe("Waiting 3 days");
    expect(waitLabel({ kind: "leave", since: "2026-11-19T10:00:00Z", due_on: null }, today)).toBe("Waiting 1 day");
    expect(waitLabel({ kind: "document", since: "2026-11-20T01:00:00Z", due_on: null }, today)).toBe("Waiting since today");
  });
  it("counts a late-evening UTC time as the next day in India", () => {
    expect(waitLabel({ kind: "document", since: "2026-11-19T19:00:00Z", due_on: null }, today)).toBe("Waiting since today");
  });
  it("shows an expiry as days to go or days past", () => {
    expect(waitLabel({ kind: "expiring", since: null, due_on: "2026-11-25" }, today)).toBe("Expires in 5 days");
    expect(waitLabel({ kind: "expiring", since: null, due_on: "2026-11-19" }, today)).toBe("Expired 1 day ago");
  });
  it("shows a checklist step as due or overdue", () => {
    expect(waitLabel({ kind: "onboarding", since: "2026-11-01T00:00:00Z", due_on: "2026-11-20" }, today)).toBe("Due today");
    expect(waitLabel({ kind: "onboarding", since: "2026-11-01T00:00:00Z", due_on: "2026-11-17" }, today)).toBe("Overdue by 3 days");
  });
});

describe("actionDetail", () => {
  it("turns codes into words", () => {
    expect(actionDetail({ kind: "document", detail: "id_proof" })).toBe("ID proof");
    expect(actionDetail({ kind: "request", detail: "experience_letter" })).toBe("Experience letter");
    expect(actionDetail({ kind: "onboarding", detail: "joiner - employee" })).toBe("Joining · The person");
    expect(actionDetail({ kind: "onboarding", detail: "leaver - hr" })).toBe("Leaving · HR");
    expect(actionDetail({ kind: "leave", detail: "2.0 days" })).toBe("2.0 days");
  });
});

describe("groupOverview", () => {
  it("files rows under their list and ignores unknown ones", () => {
    const r = (list: string) => ({ list, staff_id: "s", full_name: "A", on_date: "2026-11-20", detail: "" });
    const g = groupOverview([r("on_leave"), r("birthday"), r("on_leave"), r("mystery")]);
    expect(g.on_leave).toHaveLength(2);
    expect(g.birthday).toHaveLength(1);
    expect(g.joining).toHaveLength(0);
  });
});

describe("inDaysLabel", () => {
  it("reads naturally", () => {
    expect(inDaysLabel("2026-11-20", "2026-11-20")).toBe("Today");
    expect(inDaysLabel("2026-11-21", "2026-11-20")).toBe("Tomorrow");
    expect(inDaysLabel("2026-11-25", "2026-11-20")).toBe("In 5 days");
  });
});
