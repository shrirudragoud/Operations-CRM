import { describe, expect, it } from "vitest";
import type { MeetingView } from "@/lib/ai/areas/calendar";
import { mergeMeeting } from "@/lib/ai/calendar-drafts";
import { fakeEnv, ID, ME } from "@/lib/ai/fake-env";
import { runTool, toolsFor } from "@/lib/ai/registry";
import { toDraftCard } from "@/lib/ai/thread";
import { MAX_DRAFTS_PER_MESSAGE } from "@/lib/ai/tools";

const budget = () => ({ drafts: MAX_DRAFTS_PER_MESSAGE });
const MEETING = "33333333-3333-4333-8333-333333333333";
const WRITES = ["propose_schedule_meeting", "propose_update_meeting", "propose_cancel_meeting", "propose_rsvp"];

const live = (over: Partial<MeetingView> = {}): MeetingView => ({
  id: MEETING, title: "Weekly sync", description: "Agenda", kind: "team", department: null, visibility: "invitees", status: "scheduled",
  starts_at: "2026-11-27T04:30:00.000Z", ends_at: "2026-11-27T05:30:00.000Z", location: "Room 2", organizer_id: ID.me, organizer: "Maya Founder",
  host: null, awaiting: null, cancel_reason: null, institution: null, event: null, recurring: false,
  attendees: [{ staff_id: ID.asha, name: "Asha Rao", rsvp: "invited" }],
  ...over,
});

const withMeeting = (m: MeetingView | null, extra: Record<string, unknown> = {}) =>
  fakeEnv({ calendar: { items: async () => ({ items: [], truncated: false }), meeting: async () => m, busy: async () => [], waiting: async () => ({ requests: [], invitations: [] }) }, ...extra });

const base = { title: "Budget review", date: "2026-12-02", start_time: "10:00", end_time: "10:30" };

describe("who is offered the calendar write tools", () => {
  it("staff get them, a partner does not", () => {
    expect(toolsFor(ME).map((t) => t.name)).toEqual(expect.arrayContaining(WRITES));
    expect(toolsFor({ ...ME, role: "member" }).map((t) => t.name)).toEqual(expect.arrayContaining(WRITES));
    expect(toolsFor({ ...ME, role: "partner" }).some((t) => WRITES.includes(t.name))).toBe(false);
  });
  it("a partner who names one anyway is refused", async () => {
    const { env, saved } = fakeEnv({ me: { ...ME, role: "partner" } });
    expect(await runTool(env, "propose_schedule_meeting", base, budget())).toEqual({ error: "That is not something this person's role may do." });
    expect(saved).toHaveLength(0);
  });
});

describe("propose_schedule_meeting", () => {
  it("saves a draft with India-time strings the form schema accepts, and names who is told", async () => {
    const { env, saved } = fakeEnv();
    const r = (await runTool(env, "propose_schedule_meeting", { ...base, attendee_ids: [ID.asha, ID.ravi] }, budget())) as { draft_id: string; summary: string };
    expect(r.draft_id).toBeTruthy();
    expect(saved[0]?.kind).toBe("schedule_meeting");
    expect(saved[0]?.payload).toMatchObject({ date: "2026-12-02", start_time: "10:00", end_time: "10:30", mode: "schedule", repeat: "none", attendees: [ID.asha, ID.ravi], institution_id: "" });
    expect(r.summary.split("\n")[0]).toBe('Schedule "Budget review" on Wed 2 Dec, 10:00 am - 10:30 am');
    expect(r.summary).toContain("Asha Rao, Ravi Kumar are told as soon as it is booked.");
  });
  it("warns about busy people but still drafts", async () => {
    const { env } = withMeeting(null, { calendar: { items: async () => ({ items: [], truncated: false }), meeting: async () => null, busy: async () => [{ staff_id: ID.asha, kind: "meeting", starts_at: "2026-12-02T04:30:00.000Z", ends_at: "2026-12-02T05:00:00.000Z" }], waiting: async () => ({ requests: [], invitations: [] }) } });
    const r = (await runTool(env, "propose_schedule_meeting", { ...base, attendee_ids: [ID.asha] }, budget())) as { summary: string; draft_id: string };
    expect(r.draft_id).toBeTruthy();
    expect(r.summary).toContain("Already busy then: Asha Rao.");
  });
  it("asks the busy check in UTC for the India window", async () => {
    let window: string[] = [];
    const { env } = fakeEnv({ calendar: { items: async () => ({ items: [], truncated: false }), meeting: async () => null, busy: async (_ids, from, to) => ((window = [from, to]), []), waiting: async () => ({ requests: [], invitations: [] }) } });
    await runTool(env, "propose_schedule_meeting", { ...base, attendee_ids: [ID.asha] }, budget());
    expect(window).toEqual(["2026-12-02T04:30:00.000Z", "2026-12-02T05:00:00.000Z"]);
  });
  it("refuses the past, a backwards time, an unknown person and a request without a host", async () => {
    const { env, saved } = fakeEnv();
    const past = (await runTool(env, "propose_schedule_meeting", { ...base, date: "2026-11-01" }, budget())) as { error: string };
    expect(past.error).toContain("past");
    expect(await runTool(env, "propose_schedule_meeting", { ...base, start_time: "11:00" }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_schedule_meeting", { ...base, attendee_ids: [ID.ghost] }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_schedule_meeting", { ...base, mode: "request" }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_schedule_meeting", { ...base, start_time: "10am" }, budget())).toHaveProperty("error");
    expect(saved).toHaveLength(0);
  });
  it("a request names the person asked and invites nobody else", async () => {
    const { env, saved } = fakeEnv();
    const r = (await runTool(env, "propose_schedule_meeting", { ...base, mode: "request", host_id: ID.asha, attendee_ids: [ID.ravi] }, budget())) as { summary: string };
    expect(saved[0]?.payload).toMatchObject({ mode: "request", host_id: ID.asha, attendees: [], kind: "one_to_one" });
    expect(r.summary).toContain("Ask Asha Rao for a meeting");
  });
  it("a repeating meeting needs people or a department, and a monthly one is drafted as given", async () => {
    const { env } = fakeEnv();
    expect(await runTool(env, "propose_schedule_meeting", { ...base, repeat: "weekly" }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_schedule_meeting", { ...base, repeat: "weekly", attendee_ids: [ID.asha] }, budget())).toHaveProperty("draft_id");
  });
  it("does not draft the same meeting twice", async () => {
    const { env, saved } = fakeEnv();
    await runTool(env, "propose_schedule_meeting", base, budget());
    const again = (await runTool(env, "propose_schedule_meeting", base, budget())) as { already_drafted?: boolean };
    expect(again.already_drafted).toBe(true);
    expect(saved).toHaveLength(1);
  });
});

describe("propose_update_meeting", () => {
  it("keeps only what changes, and says who is told", async () => {
    const { env, saved } = withMeeting(live());
    const r = (await runTool(env, "propose_update_meeting", { meeting_id: MEETING, start_time: "11:00", end_time: "12:00" }, budget())) as { summary: string };
    expect(saved[0]?.payload).toEqual({ id: MEETING, meeting_title: "Weekly sync", changes: { start_time: "11:00", end_time: "12:00" } });
    expect(r.summary).toContain("The 1 person invited is told.");
  });
  it("refuses a change with nothing in it, a backwards time, a past day and a cancelled meeting", async () => {
    const { env } = withMeeting(live());
    expect(await runTool(env, "propose_update_meeting", { meeting_id: MEETING }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_update_meeting", { meeting_id: MEETING, end_time: "09:00" }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_update_meeting", { meeting_id: MEETING, date: "2026-11-01" }, budget())).toHaveProperty("error");
    const { env: cancelled } = withMeeting(live({ status: "cancelled" }));
    expect(await runTool(cancelled, "propose_update_meeting", { meeting_id: MEETING, title: "x" }, budget())).toHaveProperty("error");
  });
  it("tells someone who does not manage the meeting that they cannot", async () => {
    const { env, saved } = withMeeting(live({ organizer_id: ID.ravi }), { me: { ...ME, id: ID.asha, role: "member" as const } });
    const r = (await runTool(env, "propose_update_meeting", { meeting_id: MEETING, title: "New" }, budget())) as { error: string };
    expect(r.error).toContain("organizer");
    expect(saved).toHaveLength(0);
  });
  it("says so when the meeting is not visible", async () => {
    const { env } = withMeeting(null);
    expect(await runTool(env, "propose_update_meeting", { meeting_id: MEETING, title: "x" }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_update_meeting", { meeting_id: "nope", title: "x" }, budget())).toHaveProperty("error");
  });
});

describe("propose_cancel_meeting and propose_rsvp", () => {
  it("cancelling needs a reason and a meeting that is not already cancelled", async () => {
    const { env, saved } = withMeeting(live());
    expect(await runTool(env, "propose_cancel_meeting", { meeting_id: MEETING }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_cancel_meeting", { meeting_id: MEETING, reason: "Clash with a school visit" }, budget())).toHaveProperty("draft_id");
    expect(saved[0]?.payload).toEqual({ id: MEETING, meeting_title: "Weekly sync", reason: "Clash with a school visit" });
    const { env: gone } = withMeeting(live({ status: "cancelled" }));
    expect(await runTool(gone, "propose_cancel_meeting", { meeting_id: MEETING, reason: "x" }, budget())).toHaveProperty("error");
  });
  it("answering needs an invitation and a valid answer", async () => {
    const me = { ...ME, id: ID.asha, role: "member" as const };
    const { env, saved } = withMeeting(live(), { me });
    expect(await runTool(env, "propose_rsvp", { meeting_id: MEETING, rsvp: "maybe" }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_rsvp", { meeting_id: MEETING, rsvp: "accepted", note: "Will be 5 minutes late" }, budget())).toHaveProperty("draft_id");
    expect(saved[0]?.payload).toEqual({ meeting_id: MEETING, meeting_title: "Weekly sync", rsvp: "accepted", note: "Will be 5 minutes late" });
    const { env: outsider } = withMeeting(live(), { me: { ...ME, id: ID.ravi, role: "member" as const } });
    expect(await runTool(outsider, "propose_rsvp", { meeting_id: MEETING, rsvp: "accepted" }, budget())).toHaveProperty("error");
  });
});

describe("mergeMeeting", () => {
  it("lays the changes over the live meeting in India time", () => {
    expect(mergeMeeting(live(), { start_time: "11:00" })).toMatchObject({
      id: MEETING, title: "Weekly sync", description: "Agenda", location: "Room 2", kind: "team", visibility: "invitees", department: "",
      date: "2026-11-27", start_time: "11:00", end_time: "11:00",
    });
  });
  it("keeps the live end time when only the start changes", () => {
    expect(mergeMeeting(live(), { title: "New" })).toMatchObject({ start_time: "10:00", end_time: "11:00", title: "New" });
  });
});

describe("the draft card", () => {
  it("shows rows, the headline and notes apart, and links the meeting once it ran", () => {
    const row = { id: "a", kind: "schedule_meeting", status: "done", error: null, expires_at: "2099-01-01T00:00:00Z", result: { id: MEETING, kind: "meeting" }, summary: 'Schedule "Budget review" on Wed 2 Dec, 10:00 am - 10:30 am\nAsha Rao is told as soon as it is booked.', payload: { ...base, description: "", location: "Room 2", kind: "team", visibility: "invitees", department: "", attendees: [ID.asha], institution_id: "", mode: "schedule", host_id: "", repeat: "none", ends_on: "", all_department: false } };
    const card = toDraftCard(row, Date.now(), new Map([[ID.asha, "Asha Rao"]]));
    expect(card.summary).toBe('Schedule "Budget review" on Wed 2 Dec, 10:00 am - 10:30 am');
    expect(card.notes).toEqual(["Asha Rao is told as soon as it is booked."]);
    expect(card.rows).toEqual(expect.arrayContaining([{ label: "Invited", value: "Asha Rao" }, { label: "When", value: "Wed 2 Dec, 10:00 am - 10:30 am" }, { label: "Place", value: "Room 2" }]));
    expect(card.links).toEqual([{ href: `/calendar/${MEETING}`, label: "Open the meeting", ref: { kind: "meeting", id: MEETING } }]);
    expect(card.taskIds).toEqual([]);
  });
  it("does not mistake a meeting id for a task id", () => {
    const card = toDraftCard({ id: "b", kind: "cancel_meeting", status: "done", error: null, expires_at: "2099-01-01T00:00:00Z", result: {}, summary: "Cancel", payload: { id: MEETING, meeting_title: "Weekly sync", reason: "Clash" } });
    expect(card.taskIds).toEqual([]);
    expect(card.links[0]?.href).toBe(`/calendar/${MEETING}`);
  });
});
