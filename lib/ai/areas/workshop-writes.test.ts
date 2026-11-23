import { describe, expect, it } from "vitest";
import type { EventView } from "@/lib/ai/areas/workshop";
import type { InstitutionView } from "@/lib/ai/areas/sales";
import { fakeEnv, ID, ME } from "@/lib/ai/fake-env";
import { runTool, toolsFor } from "@/lib/ai/registry";
import { toDraftCard } from "@/lib/ai/thread";
import { MAX_DRAFTS_PER_MESSAGE } from "@/lib/ai/tools";
import { mergeEvent } from "@/lib/ai/workshop-drafts";

const budget = () => ({ drafts: MAX_DRAFTS_PER_MESSAGE });
const EVENT = "44444444-4444-4444-8444-444444444444";
const INST = "55555555-5555-4555-8555-555555555555";
const PRE = "66666666-6666-4666-8666-666666666661";
const DAY = "66666666-6666-4666-8666-666666666662";
const POST = "66666666-6666-4666-8666-666666666663";
const WRITES = ["propose_create_event", "propose_update_event", "propose_set_event_team", "propose_event_status", "propose_run_sheet_item"];

const live = (over: Partial<EventView> = {}): EventView => ({
  id: EVENT, title: "School workshop - St Mary's", kind: "school_workshop", status: "scheduled",
  starts_at: "2026-12-10T04:30:00.000Z", ends_at: "2026-12-10T10:30:00.000Z", venue: "Main hall", expected_headcount: 80,
  lead_trainer_id: ID.asha, lead: "Asha Rao", institution: { id: INST, name: "St Mary's", city: "Pune" },
  actual_headcount: null, satisfaction_score: null, cancel_reason: null, archived: false,
  team: [{ staff_id: ID.ravi, name: "Ravi Kumar", role: "assistant" }],
  run_sheet: [
    { id: PRE, phase: "pre", label: "Confirm the venue", done: true },
    { id: DAY, phase: "day", label: "Take attendance", done: false },
    { id: POST, phase: "post", label: "Send the report", done: false },
  ],
  ...over,
});

const TRAINERS = [
  { staff_id: ID.asha, full_name: "Asha Rao", level: "certified", is_free: true },
  { staff_id: ID.ravi, full_name: "Ravi Kumar", level: "certified", is_free: false },
];

const withEvent = (e: EventView | null, extra: { me?: typeof ME; trainers?: typeof TRAINERS } = {}) =>
  fakeEnv({ ...(extra.me ? { me: extra.me } : {}), workshop: { events: async () => ({ rows: [], total: 0 }), event: async () => e, trainers: async () => extra.trainers ?? TRAINERS } });

const institution = (over: Partial<InstitutionView> = {}): InstitutionView => ({
  id: INST, name: "St Mary's", kind: "school", city: "Pune", district: null, stage: "lead", owner: null, affiliation: null, state: null, source: null,
  notes: null, archived: false, contacts: [], activities: [], deals: [], events: [], ...over,
});

const withInstitution = (i: InstitutionView | null) => {
  const { env, saved } = fakeEnv();
  env.sales = { ...env.sales, institution: async () => i };
  return { env, saved };
};

describe("who is offered the workshop write tools", () => {
  it("founder and workshop staff get them; others and partners do not", () => {
    expect(toolsFor(ME).map((t) => t.name)).toEqual(expect.arrayContaining(WRITES));
    expect(toolsFor({ ...ME, role: "member", departments: ["workshop"] }).map((t) => t.name)).toEqual(expect.arrayContaining(WRITES));
    expect(toolsFor({ ...ME, role: "member", departments: ["sales"] }).some((t) => WRITES.includes(t.name))).toBe(false);
    expect(toolsFor({ ...ME, role: "partner" }).some((t) => WRITES.includes(t.name))).toBe(false);
  });
  it("is refused for someone who names a tool they were not offered", async () => {
    const { env, saved } = withEvent(live(), { me: { ...ME, role: "member", departments: ["sales"] } });
    expect(await runTool(env, "propose_event_status", { event_id: EVENT, action: "start" }, budget())).toEqual({ error: "That is not something this person's role may do." });
    expect(saved).toHaveLength(0);
  });
});

describe("propose_create_event", () => {
  it("drafts a new event for a visible institution", async () => {
    const { env, saved } = withInstitution(institution());
    const r = (await runTool(env, "propose_create_event", { institution_id: INST, kind: "school_workshop" }, budget())) as { draft_id: string; summary: string };
    expect(r.draft_id).toBeTruthy();
    expect(saved[0]?.kind).toBe("create_event");
    expect(saved[0]?.payload).toEqual({ institution_id: INST, institution_name: "St Mary's", kind: "school_workshop", title: "" });
    expect(r.summary).toContain("St Mary's");
    expect(r.summary).toContain("needs dates");
  });
  it("refuses an unknown or archived institution, a bad kind and a bad id", async () => {
    const none = withInstitution(null);
    expect(await runTool(none.env, "propose_create_event", { institution_id: INST, kind: "school_workshop" }, budget())).toHaveProperty("error");
    const archived = withInstitution(institution({ archived: true }));
    expect(await runTool(archived.env, "propose_create_event", { institution_id: INST, kind: "school_workshop" }, budget())).toHaveProperty("error");
    const ok = withInstitution(institution());
    expect(await runTool(ok.env, "propose_create_event", { institution_id: INST, kind: "party" }, budget())).toHaveProperty("error");
    expect(await runTool(ok.env, "propose_create_event", { institution_id: "nope", kind: "fdp" }, budget())).toHaveProperty("error");
    expect(none.saved.length + archived.saved.length + ok.saved.length).toBe(0);
  });
});

describe("propose_update_event", () => {
  it("keeps only the changes, in the form the update action takes", async () => {
    const { env, saved } = withEvent(live());
    await runTool(env, "propose_update_event", { event_id: EVENT, venue: "Annex", expected_headcount: 90 }, budget());
    expect(saved[0]?.kind).toBe("update_event");
    expect(saved[0]?.payload).toEqual({ id: EVENT, event_title: "School workshop - St Mary's", changes: { venue: "Annex", expected_headcount: "90" } });
  });
  it("changing only the start time keeps the live date", async () => {
    const { env, saved } = withEvent(live());
    await runTool(env, "propose_update_event", { event_id: EVENT, start_time: "11:00" }, budget());
    expect((saved[0]?.payload.changes as Record<string, string>).starts_at).toBe("2026-12-10T11:00");
  });
  it("refuses empty changes, the past, an end before the start and a finished event", async () => {
    const { env, saved } = withEvent(live());
    expect(await runTool(env, "propose_update_event", { event_id: EVENT }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_update_event", { event_id: EVENT, start_date: "2026-11-01", end_date: "2026-11-02" }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_update_event", { event_id: EVENT, start_time: "18:00" }, budget())).toHaveProperty("error");
    const done = withEvent(live({ status: "completed" }));
    expect(await runTool(done.env, "propose_update_event", { event_id: EVENT, venue: "x" }, budget())).toHaveProperty("error");
    const gone = withEvent(null);
    expect(await runTool(gone.env, "propose_update_event", { event_id: EVENT, venue: "x" }, budget())).toHaveProperty("error");
    expect(saved).toHaveLength(0);
  });
  it("needs both parts of a date and time when the event has none yet", async () => {
    const { env } = withEvent(live({ status: "draft", starts_at: null, ends_at: null }));
    expect(await runTool(env, "propose_update_event", { event_id: EVENT, start_date: "2026-12-10" }, budget())).toHaveProperty("error");
    const ok = (await runTool(env, "propose_update_event", { event_id: EVENT, start_date: "2026-12-10", start_time: "09:00", end_date: "2026-12-10", end_time: "15:00" }, budget())) as { draft_id: string };
    expect(ok.draft_id).toBeTruthy();
  });
});

describe("propose_set_event_team", () => {
  it("drafts the team, keeping current assistants when none are sent", async () => {
    const { env, saved } = withEvent(live(), { trainers: [{ ...TRAINERS[0]!, is_free: true }, { ...TRAINERS[1]!, is_free: true }] });
    const r = (await runTool(env, "propose_set_event_team", { event_id: EVENT, lead_trainer_id: ID.asha }, budget())) as { draft_id: string };
    expect(r.draft_id).toBeTruthy();
    expect(saved[0]?.payload).toEqual({ id: EVENT, event_title: "School workshop - St Mary's", lead_trainer_id: ID.asha, assistants: [ID.ravi] });
  });
  it("calls out someone already booked, and refuses a lead who is not certified", async () => {
    const { env } = withEvent(live());
    const busy = (await runTool(env, "propose_set_event_team", { event_id: EVENT, lead_trainer_id: ID.asha, assistant_ids: [ID.ravi] }, budget())) as { summary: string };
    expect(busy.summary).toContain("Already booked at that time: Ravi Kumar");
    expect(await runTool(env, "propose_set_event_team", { event_id: EVENT, lead_trainer_id: ID.ravi2 }, budget())).toHaveProperty("error");
  });
  it("says availability was not checked when the event has no dates", async () => {
    const { env } = withEvent(live({ status: "draft", starts_at: null, ends_at: null }));
    const r = (await runTool(env, "propose_set_event_team", { event_id: EVENT, lead_trainer_id: ID.asha, assistant_ids: [] }, budget())) as { summary: string };
    expect(r.summary).toContain("no dates yet");
  });
  it("refuses a missing lead, more than two assistants, the lead as assistant and an unknown person", async () => {
    const { env, saved } = withEvent(live());
    expect(await runTool(env, "propose_set_event_team", { event_id: EVENT }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_set_event_team", { event_id: EVENT, lead_trainer_id: ID.asha, assistant_ids: [ID.me, ID.ravi, ID.ravi2] }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_set_event_team", { event_id: EVENT, lead_trainer_id: ID.asha, assistant_ids: [ID.asha] }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_set_event_team", { event_id: EVENT, lead_trainer_id: ID.ghost }, budget())).toHaveProperty("error");
    expect(saved).toHaveLength(0);
  });
});

describe("propose_event_status", () => {
  it("schedules a ready event, starts a scheduled one and cancels with a reason", async () => {
    const draft = withEvent(live({ status: "draft" }));
    expect(await runTool(draft.env, "propose_event_status", { event_id: EVENT, action: "schedule" }, budget())).toHaveProperty("draft_id");
    expect(draft.saved[0]?.payload).toEqual({ id: EVENT, event_title: "School workshop - St Mary's", action: "schedule" });
    const sched = withEvent(live());
    expect(await runTool(sched.env, "propose_event_status", { event_id: EVENT, action: "start" }, budget())).toHaveProperty("draft_id");
    const cancel = (await runTool(sched.env, "propose_event_status", { event_id: EVENT, action: "cancel", reason: "School closed for exams" }, budget())) as { summary: string };
    expect(cancel.summary).toContain("Cancel");
    expect(sched.saved[1]?.payload).toMatchObject({ action: "cancel", reason: "School closed for exams" });
  });
  it("refuses scheduling while things are missing, cancelling without a reason and moves the rules do not allow", async () => {
    const missing = withEvent(live({ status: "draft", venue: null, lead_trainer_id: null }));
    const r = (await runTool(missing.env, "propose_event_status", { event_id: EVENT, action: "schedule" }, budget())) as { error: string };
    expect(r.error).toContain("lead trainer");
    expect(r.error).toContain("venue");
    const { env, saved } = withEvent(live());
    expect(await runTool(env, "propose_event_status", { event_id: EVENT, action: "cancel" }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_event_status", { event_id: EVENT, action: "schedule" }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_event_status", { event_id: EVENT, action: "explode" }, budget())).toHaveProperty("error");
    const finished = withEvent(live({ status: "completed" }));
    expect(await runTool(finished.env, "propose_event_status", { event_id: EVENT, action: "cancel", reason: "x" }, budget())).toHaveProperty("error");
    expect(saved).toHaveLength(0);
  });
  it("completing needs a headcount and the run sheet items before and on the day ticked off", async () => {
    const blocked = withEvent(live({ status: "in_progress" }));
    const b = (await runTool(blocked.env, "propose_event_status", { event_id: EVENT, action: "complete", actual_headcount: 72 }, budget())) as { error: string };
    expect(b.error).toContain("1 run sheet item");
    const ready = withEvent(live({ status: "in_progress", run_sheet: live().run_sheet.map((i) => ({ ...i, done: i.phase !== "post" })) }));
    expect(await runTool(ready.env, "propose_event_status", { event_id: EVENT, action: "complete" }, budget())).toHaveProperty("error");
    expect(await runTool(ready.env, "propose_event_status", { event_id: EVENT, action: "complete", actual_headcount: 72, satisfaction_score: 4.5 }, budget())).toHaveProperty("draft_id");
    expect(ready.saved[0]?.payload).toMatchObject({ action: "complete", actual_headcount: "72", satisfaction_score: "4.5" });
  });
});

describe("propose_run_sheet_item", () => {
  it("drafts ticking an item and refuses one that is already in that state or not on the sheet", async () => {
    const { env, saved } = withEvent(live());
    expect(await runTool(env, "propose_run_sheet_item", { event_id: EVENT, item_id: DAY, done: true }, budget())).toHaveProperty("draft_id");
    expect(saved[0]?.payload).toEqual({ id: DAY, event_id: EVENT, event_title: "School workshop - St Mary's", item: "Take attendance", done: true });
    expect(await runTool(env, "propose_run_sheet_item", { event_id: EVENT, item_id: PRE, done: true }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_run_sheet_item", { event_id: EVENT, item_id: ID.ghost, done: true }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_run_sheet_item", { event_id: EVENT, item_id: DAY }, budget())).toHaveProperty("error");
  });
  it("is refused on a cancelled event", async () => {
    const { env } = withEvent(live({ status: "cancelled" }));
    expect(await runTool(env, "propose_run_sheet_item", { event_id: EVENT, item_id: DAY, done: true }, budget())).toHaveProperty("error");
  });
});

describe("get_event", () => {
  it("gives the run sheet item ids that the drafts need", async () => {
    const { env } = withEvent(live());
    const r = (await runTool(env, "get_event", { event_id: EVENT }, budget())) as { event: { run_sheet: { not_done: { id: string }[]; done_items: { id: string }[] } } };
    expect(r.event.run_sheet.not_done.map((i) => i.id)).toEqual([DAY, POST]);
    expect(r.event.run_sheet.done_items.map((i) => i.id)).toEqual([PRE]);
  });
});

describe("mergeEvent", () => {
  it("lays the changes over the live event in India time", () => {
    expect(mergeEvent(live(), { venue: "Annex" })).toEqual({
      id: EVENT, title: "School workshop - St Mary's", starts_at: "2026-12-10T10:00", ends_at: "2026-12-10T16:00", venue: "Annex", expected_headcount: "80",
    });
  });
});

describe("the draft card", () => {
  const row = (kind: string, payload: Record<string, unknown>, result: Record<string, unknown> = {}, summary = "Headline") => ({
    id: "a", kind, status: "done", error: null, expires_at: "2099-01-01T00:00:00Z", result, summary, payload,
  });
  const names = new Map([[ID.asha, "Asha Rao"], [ID.ravi, "Ravi Kumar"]]);

  it("shows the new event and links it once created", () => {
    const card = toDraftCard(row("create_event", { institution_id: INST, institution_name: "St Mary's", kind: "school_workshop", title: "" }, { id: EVENT }), Date.now(), names);
    expect(card.rows).toEqual(expect.arrayContaining([{ label: "Institution", value: "St Mary's" }]));
    expect(card.links).toEqual([{ href: `/workshop/${EVENT}`, label: "Open the event", ref: { kind: "event", id: EVENT } }]);
    expect(card.taskIds).toEqual([]);
  });
  it("names the team", () => {
    const card = toDraftCard(row("set_event_team", { id: EVENT, event_title: "X", lead_trainer_id: ID.asha, assistants: [ID.ravi] }), Date.now(), names);
    expect(card.rows).toEqual(expect.arrayContaining([{ label: "Lead", value: "Asha Rao" }, { label: "Assistants", value: "Ravi Kumar" }]));
  });
  it("links the event, not the item, for a run sheet tick", () => {
    const card = toDraftCard(row("toggle_run_item", { id: DAY, event_id: EVENT, event_title: "X", item: "Take attendance", done: true }), Date.now(), names);
    expect(card.links[0]?.href).toBe(`/workshop/${EVENT}`);
    expect(card.rows).toEqual(expect.arrayContaining([{ label: "Mark as", value: "Done" }]));
  });
  it("shows status changes with their reason or headcount", () => {
    const cancel = toDraftCard(row("event_status", { id: EVENT, event_title: "X", action: "cancel", reason: "Exams" }), Date.now(), names);
    expect(cancel.rows).toEqual(expect.arrayContaining([{ label: "Action", value: "Cancel" }, { label: "Reason", value: "Exams" }]));
    const complete = toDraftCard(row("event_status", { id: EVENT, event_title: "X", action: "complete", actual_headcount: "72", satisfaction_score: "" }), Date.now(), names);
    expect(complete.rows).toEqual(expect.arrayContaining([{ label: "Students came", value: "72" }]));
  });
});
