import { describe, expect, it } from "vitest";
import { activitySchema, happenedAtFor, outreachQuery, parseOutreachParams, setTaskStatusSchema } from "./activity";
import { todayIST } from "@/lib/format";

const UUID = "00000000-0000-4000-8000-000000000001";
const base = {
  institution_id: UUID, contact_id: "", kind: "visit", outcome: "", notes: "", happened_on: "", next_step: "", next_step_due: "",
};

function plusDays(n: number): string {
  return todayIST(new Date(Date.now() + n * 86_400_000));
}

describe("activitySchema", () => {
  it("turns empty optional fields into null", () => {
    const r = activitySchema.parse(base);
    expect(r.contact_id).toBeNull();
    expect(r.outcome).toBeNull();
    expect(r.notes).toBeNull();
    expect(r.happened_on).toBeNull();
    expect(r.next_step).toBeNull();
  });
  it("needs an institution and a known kind and outcome", () => {
    expect(activitySchema.safeParse({ ...base, institution_id: "" }).success).toBe(false);
    expect(activitySchema.safeParse({ ...base, kind: "pigeon" }).success).toBe(false);
    expect(activitySchema.safeParse({ ...base, outcome: "won" }).success).toBe(false);
    expect(activitySchema.safeParse({ ...base, outcome: "qualified" }).success).toBe(true);
  });
  it("needs a next step and a due date together, so a follow-up task can be made", () => {
    const noDue = activitySchema.safeParse({ ...base, next_step: "Call the principal" });
    expect(noDue.error?.issues[0]?.path).toEqual(["next_step_due"]);
    const noStep = activitySchema.safeParse({ ...base, next_step_due: plusDays(2) });
    expect(noStep.error?.issues[0]?.path).toEqual(["next_step"]);
    expect(activitySchema.safeParse({ ...base, next_step: "Call", next_step_due: plusDays(2) }).success).toBe(true);
  });
  it("rejects a future activity date and a past due date", () => {
    expect(activitySchema.safeParse({ ...base, happened_on: plusDays(3) }).success).toBe(false);
    expect(activitySchema.safeParse({ ...base, happened_on: plusDays(-3) }).success).toBe(true);
    expect(activitySchema.safeParse({ ...base, next_step: "Call", next_step_due: plusDays(-1) }).success).toBe(false);
    expect(activitySchema.safeParse({ ...base, next_step: "Call", next_step_due: todayIST() }).success).toBe(true);
  });
  it("rejects malformed dates and over-long notes", () => {
    expect(activitySchema.safeParse({ ...base, happened_on: "yesterday" }).success).toBe(false);
    expect(activitySchema.safeParse({ ...base, notes: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("happenedAtFor", () => {
  it("uses the database default (now) for today or no date", () => {
    expect(happenedAtFor(null)).toBeNull();
    expect(happenedAtFor("2026-11-16", "2026-11-16")).toBeNull();
  });
  it("stamps a backdated activity at noon India time", () => {
    expect(happenedAtFor("2026-11-10", "2026-11-16")).toBe("2026-11-10T12:00:00+05:30");
  });
});

describe("setTaskStatusSchema", () => {
  it("accepts known statuses only", () => {
    expect(setTaskStatusSchema.safeParse({ id: UUID, status: "done" }).success).toBe(true);
    expect(setTaskStatusSchema.safeParse({ id: UUID, status: "finished" }).success).toBe(false);
    expect(setTaskStatusSchema.safeParse({ id: "x", status: "done" }).success).toBe(false);
  });
});

describe("outreach URL params", () => {
  it("falls back to safe defaults for anything invalid", () => {
    const p = parseOutreachParams({ tab: "nope", scope: "x", segment: "zzz", touch: "??", page: "-4" });
    expect(p).toEqual({ tab: "followups", scope: "mine", segment: "", touch: "all", district: "", page: 1 });
  });
  it("strips characters that would change a filter pattern", () => {
    expect(parseOutreachParams({ district: "Pune,(%)*" }).district).toBe("Pune");
  });
  it("round-trips and omits defaults", () => {
    const p = parseOutreachParams({ tab: "territory", segment: "school", touch: "untouched", district: "Pune", page: "3" });
    expect(parseOutreachParams(Object.fromEntries(new URLSearchParams(outreachQuery(p))))).toEqual(p);
    expect(outreachQuery({ tab: "followups", scope: "mine", segment: "", touch: "all", district: "", page: 1 })).toBe("");
  });
});
