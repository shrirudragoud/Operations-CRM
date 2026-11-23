import { describe, expect, it } from "vitest";
import type { DealView, InstitutionView } from "@/lib/ai/areas/sales";
import { fakeEnv, ID, ME } from "@/lib/ai/fake-env";
import { runTool, toolsFor } from "@/lib/ai/registry";
import { mergeDeal } from "@/lib/ai/sales-drafts";
import { toDraftCard } from "@/lib/ai/thread";
import { MAX_DRAFTS_PER_MESSAGE } from "@/lib/ai/tools";

const budget = () => ({ drafts: MAX_DRAFTS_PER_MESSAGE });
const INST = "55555555-5555-4555-8555-555555555555";
const DEAL = "77777777-7777-4777-8777-777777777777";
const DEAL_TOOLS = ["propose_create_deal", "propose_update_deal", "propose_move_deal"];
const ACTIVITY_TOOL = "propose_log_activity";
const names = (me: typeof ME) => toolsFor(me).map((t) => t.name);

const institution = (over: Partial<InstitutionView> = {}): InstitutionView => ({
  id: INST, name: "St Mary's", kind: "school", city: "Pune", district: null, stage: "lead", owner: null, affiliation: null, state: null, source: null,
  notes: null, archived: false, contacts: [], activities: [], deals: [], events: [], ...over,
});

const deal = (over: Partial<DealView> = {}): DealView => ({
  id: DEAL, title: "Workshop - St Mary's", kind: "workshop", stage: "proposal", value_inr: 250000, probability: 40, expected_close: "2026-12-10",
  owner: "Ravi Kumar", owner_id: ID.me, institution: { id: INST, name: "St Mary's", city: "Pune" },
  lost_reason: null, won_at: null, archived: false, lines: [], events: [], ...over,
});

const withInstitution = (i: InstitutionView | null, me?: typeof ME) => {
  const { env, saved } = fakeEnv(me ? { me } : {});
  env.sales = { ...env.sales, institution: async () => i };
  return { env, saved };
};

const withDeal = (d: DealView | null, me?: typeof ME) => {
  const { env, saved } = fakeEnv(me ? { me } : {});
  env.sales = { ...env.sales, deal: async () => d };
  return { env, saved };
};

describe("who is offered the sales and outreach write tools", () => {
  it("the founder gets all of them", () => {
    expect(names(ME)).toEqual(expect.arrayContaining([...DEAL_TOOLS, ACTIVITY_TOOL]));
  });
  it("sales staff get the deal tools, outreach staff the activity tool, nobody else either", () => {
    const sales = names({ ...ME, role: "member", departments: ["sales"] });
    expect(sales).toEqual(expect.arrayContaining(DEAL_TOOLS));
    expect(sales).not.toContain(ACTIVITY_TOOL);
    const outreach = names({ ...ME, role: "member", departments: ["outreach"] });
    expect(outreach).toContain(ACTIVITY_TOOL);
    expect(DEAL_TOOLS.some((t) => outreach.includes(t))).toBe(false);
    const training = names({ ...ME, role: "member", departments: ["training"] });
    expect([...DEAL_TOOLS, ACTIVITY_TOOL].some((t) => training.includes(t))).toBe(false);
  });
  it("partners get both, viewers neither", () => {
    expect(names({ ...ME, role: "partner" })).toEqual(expect.arrayContaining([...DEAL_TOOLS, ACTIVITY_TOOL]));
    const viewer = names({ ...ME, role: "viewer" });
    expect([...DEAL_TOOLS, ACTIVITY_TOOL].some((t) => viewer.includes(t))).toBe(false);
  });
  it("is refused for someone who names a tool they were not offered", async () => {
    const { env, saved } = withDeal(deal(), { ...ME, role: "viewer" });
    expect(await runTool(env, "propose_move_deal", { deal_id: DEAL, stage: "negotiation" }, budget())).toEqual({ error: "That is not something this person's role may do." });
    expect(saved).toHaveLength(0);
  });
});

describe("propose_log_activity", () => {
  it("drafts a visit with an outcome and a follow-up", async () => {
    const { env, saved } = withInstitution(institution());
    const r = (await runTool(env, ACTIVITY_TOOL, { institution_id: INST, kind: "visit", outcome: "interested", notes: "Met the principal", next_step: "Send the quote", next_step_due: "2099-01-05" }, budget())) as { draft_id: string; summary: string };
    expect(r.draft_id).toBeTruthy();
    expect(saved[0]?.kind).toBe("log_activity");
    expect(saved[0]?.payload).toEqual({
      institution_id: INST, institution_name: "St Mary's", kind: "visit", outcome: "interested", notes: "Met the principal", happened_on: "", next_step: "Send the quote", next_step_due: "2099-01-05",
    });
    expect(r.summary).toContain("St Mary's");
    expect(r.summary).toContain("follow-up task");
  });
  it("says that qualified opens a deal", async () => {
    const { env } = withInstitution(institution());
    const r = (await runTool(env, ACTIVITY_TOOL, { institution_id: INST, kind: "call", outcome: "qualified" }, budget())) as { summary: string };
    expect(r.summary).toContain("opens a Workshop deal");
  });
  it("never carries a stage", async () => {
    const { env, saved } = withInstitution(institution());
    await runTool(env, ACTIVITY_TOOL, { institution_id: INST, kind: "call", stage: "qualified" }, budget());
    expect(saved[0]?.payload).not.toHaveProperty("stage");
  });
  it("refuses a future date, a next step without a date, a past due date, a bad kind or outcome, and an unusable institution", async () => {
    const { env, saved } = withInstitution(institution());
    expect(await runTool(env, ACTIVITY_TOOL, { institution_id: INST, kind: "visit", happened_on: "2099-01-01" }, budget())).toHaveProperty("error");
    expect(await runTool(env, ACTIVITY_TOOL, { institution_id: INST, kind: "visit", next_step: "Call back" }, budget())).toHaveProperty("error");
    expect(await runTool(env, ACTIVITY_TOOL, { institution_id: INST, kind: "visit", next_step: "Call back", next_step_due: "2020-01-01" }, budget())).toHaveProperty("error");
    expect(await runTool(env, ACTIVITY_TOOL, { institution_id: INST, kind: "carrier_pigeon" }, budget())).toHaveProperty("error");
    expect(await runTool(env, ACTIVITY_TOOL, { institution_id: INST, kind: "visit", outcome: "won" }, budget())).toHaveProperty("error");
    expect(await runTool(env, ACTIVITY_TOOL, { institution_id: "nope", kind: "visit" }, budget())).toHaveProperty("error");
    const gone = withInstitution(null);
    expect(await runTool(gone.env, ACTIVITY_TOOL, { institution_id: INST, kind: "visit" }, budget())).toHaveProperty("error");
    const archived = withInstitution(institution({ archived: true }));
    expect(await runTool(archived.env, ACTIVITY_TOOL, { institution_id: INST, kind: "visit" }, budget())).toHaveProperty("error");
    expect(saved.length + gone.saved.length + archived.saved.length).toBe(0);
  });
});

describe("propose_create_deal", () => {
  it("drafts a deal with the money as the form takes it", async () => {
    const { env, saved } = withInstitution(institution());
    const r = (await runTool(env, "propose_create_deal", { institution_id: INST, kind: "workshop", value_inr: 250000, probability: 40, expected_close: "2026-12-31" }, budget())) as { draft_id: string; summary: string };
    expect(r.draft_id).toBeTruthy();
    expect(saved[0]?.kind).toBe("create_deal");
    expect(saved[0]?.payload).toEqual({ institution_id: INST, institution_name: "St Mary's", kind: "workshop", title: "", value_inr: "250000", probability: "40", expected_close: "2026-12-31" });
    expect(r.summary).toContain("St Mary's");
  });
  it("refuses a second open deal of the same type but allows another type or a closed one", async () => {
    const open = withInstitution(institution({ deals: [{ id: DEAL, title: "W", kind: "workshop", stage: "meeting", value_inr: null, expected_close: null, archived: false }] }));
    const r = (await runTool(open.env, "propose_create_deal", { institution_id: INST, kind: "workshop" }, budget())) as { error: string };
    expect(r.error).toContain("already has an open");
    expect(await runTool(open.env, "propose_create_deal", { institution_id: INST, kind: "fdp" }, budget())).toHaveProperty("draft_id");
    const closed = withInstitution(institution({ deals: [{ id: DEAL, title: "W", kind: "workshop", stage: "lost", value_inr: null, expected_close: null, archived: false }] }));
    expect(await runTool(closed.env, "propose_create_deal", { institution_id: INST, kind: "workshop" }, budget())).toHaveProperty("draft_id");
  });
  it("refuses a bad type, a bad amount, a bad probability and an unusable institution", async () => {
    const { env, saved } = withInstitution(institution());
    expect(await runTool(env, "propose_create_deal", { institution_id: INST, kind: "party" }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_create_deal", { institution_id: INST, kind: "fdp", value_inr: -5 }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_create_deal", { institution_id: INST, kind: "fdp", probability: 150 }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_create_deal", { institution_id: INST, kind: "fdp", expected_close: "soon" }, budget())).toHaveProperty("error");
    expect(await runTool(withInstitution(null).env, "propose_create_deal", { institution_id: INST, kind: "fdp" }, budget())).toHaveProperty("error");
    expect(await runTool(withInstitution(institution({ archived: true })).env, "propose_create_deal", { institution_id: INST, kind: "fdp" }, budget())).toHaveProperty("error");
    expect(saved).toHaveLength(0);
  });
});

describe("propose_update_deal", () => {
  it("keeps only the changes", async () => {
    const { env, saved } = withDeal(deal());
    await runTool(env, "propose_update_deal", { deal_id: DEAL, value_inr: 300000, expected_close: "" }, budget());
    expect(saved[0]?.kind).toBe("update_deal");
    expect(saved[0]?.payload).toEqual({ id: DEAL, deal_title: "Workshop - St Mary's", changes: { value_inr: "300000", expected_close: "" } });
  });
  it("refuses nothing to change, a blank title, a bad amount, and won, lost or archived deals", async () => {
    const { env, saved } = withDeal(deal());
    expect(await runTool(env, "propose_update_deal", { deal_id: DEAL }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_update_deal", { deal_id: DEAL, title: "  " }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_update_deal", { deal_id: DEAL, value_inr: "lots" }, budget())).toHaveProperty("error");
    for (const stage of ["won", "lost"]) {
      expect(await runTool(withDeal(deal({ stage })).env, "propose_update_deal", { deal_id: DEAL, title: "x" }, budget())).toHaveProperty("error");
    }
    expect(await runTool(withDeal(deal({ archived: true })).env, "propose_update_deal", { deal_id: DEAL, title: "x" }, budget())).toHaveProperty("error");
    expect(await runTool(withDeal(null).env, "propose_update_deal", { deal_id: DEAL, title: "x" }, budget())).toHaveProperty("error");
    expect(saved).toHaveLength(0);
  });
  it("lets a partner change only their own deal", async () => {
    const partner = { ...ME, id: ID.ravi, role: "partner" as const };
    const own = withDeal(deal({ owner_id: ID.ravi }), partner);
    expect(await runTool(own.env, "propose_update_deal", { deal_id: DEAL, title: "Mine" }, budget())).toHaveProperty("draft_id");
    const other = withDeal(deal({ owner_id: ID.asha }), partner);
    expect(await runTool(other.env, "propose_update_deal", { deal_id: DEAL, title: "Theirs" }, budget())).toHaveProperty("error");
  });
});

describe("propose_move_deal", () => {
  it("drafts an allowed move", async () => {
    const { env, saved } = withDeal(deal());
    const r = (await runTool(env, "propose_move_deal", { deal_id: DEAL, stage: "negotiation", probability: 70 }, budget())) as { summary: string };
    expect(saved[0]?.kind).toBe("move_deal");
    expect(saved[0]?.payload).toEqual({ id: DEAL, deal_title: "Workshop - St Mary's", from: "proposal", stage: "negotiation", lost_reason: "", probability: "70" });
    expect(r.summary).toContain("Proposal to Negotiation");
  });
  it("lost needs a reason, and a lost deal can only go back to meeting", async () => {
    const { env, saved } = withDeal(deal());
    expect(await runTool(env, "propose_move_deal", { deal_id: DEAL, stage: "lost" }, budget())).toHaveProperty("error");
    expect(await runTool(env, "propose_move_deal", { deal_id: DEAL, stage: "lost", lost_reason: "Budget cut" }, budget())).toHaveProperty("draft_id");
    expect(saved[0]?.payload).toMatchObject({ stage: "lost", lost_reason: "Budget cut" });
    const lost = withDeal(deal({ stage: "lost" }));
    expect(await runTool(lost.env, "propose_move_deal", { deal_id: DEAL, stage: "negotiation" }, budget())).toHaveProperty("error");
    expect(await runTool(lost.env, "propose_move_deal", { deal_id: DEAL, stage: "meeting" }, budget())).toHaveProperty("draft_id");
  });
  it("never drafts Won, even for the founder, and says why", async () => {
    const { env, saved } = withDeal(deal({ stage: "negotiation" }));
    const r = (await runTool(env, "propose_move_deal", { deal_id: DEAL, stage: "won" }, budget())) as { error: string };
    expect(r.error).toContain("Only the founder");
    expect(saved).toHaveLength(0);
  });
  it("is refused for a won deal, an archived deal, a skip the rules do not allow and an unknown stage", async () => {
    const won = withDeal(deal({ stage: "won" }));
    expect(await runTool(won.env, "propose_move_deal", { deal_id: DEAL, stage: "lost", lost_reason: "x" }, budget())).toHaveProperty("error");
    const archived = withDeal(deal({ archived: true }));
    expect(await runTool(archived.env, "propose_move_deal", { deal_id: DEAL, stage: "negotiation" }, budget())).toHaveProperty("error");
    const meeting = withDeal(deal({ stage: "meeting" }));
    expect(await runTool(meeting.env, "propose_move_deal", { deal_id: DEAL, stage: "negotiation" }, budget())).toHaveProperty("error");
    expect(await runTool(meeting.env, "propose_move_deal", { deal_id: DEAL, stage: "sideways" }, budget())).toHaveProperty("error");
    expect(won.saved.length + archived.saved.length + meeting.saved.length).toBe(0);
  });
  it("lets a partner move only their own deal", async () => {
    const partner = { ...ME, id: ID.ravi, role: "partner" as const };
    expect(await runTool(withDeal(deal({ owner_id: ID.asha }), partner).env, "propose_move_deal", { deal_id: DEAL, stage: "negotiation" }, budget())).toHaveProperty("error");
    expect(await runTool(withDeal(deal({ owner_id: ID.ravi }), partner).env, "propose_move_deal", { deal_id: DEAL, stage: "negotiation" }, budget())).toHaveProperty("draft_id");
  });
});

describe("mergeDeal", () => {
  it("lays the changes over the live deal and leaves the owner alone", () => {
    expect(mergeDeal(deal(), { title: "New" })).toEqual({ id: DEAL, title: "New", value_inr: "250000", probability: "40", expected_close: "2026-12-10", owner_id: "" });
  });
  it("turns a deal with no money or date into blanks", () => {
    expect(mergeDeal(deal({ value_inr: null, probability: null, expected_close: null }), {})).toMatchObject({ value_inr: "", probability: "", expected_close: "" });
  });
});

describe("the draft card", () => {
  const row = (kind: string, payload: Record<string, unknown>, result: Record<string, unknown> = {}) => ({
    id: "a", kind, status: "done", error: null, expires_at: "2099-01-01T00:00:00Z", result, summary: "Headline", payload,
  });
  const none = new Map<string, string>();

  it("shows a logged activity and links the institution", () => {
    const card = toDraftCard(row("log_activity", { institution_id: INST, institution_name: "St Mary's", kind: "visit", outcome: "qualified", notes: "Good", happened_on: "", next_step: "Quote", next_step_due: "2099-01-05" }), Date.now(), none);
    expect(card.rows).toEqual(expect.arrayContaining([{ label: "Institution", value: "St Mary's" }, { label: "What", value: "Visit" }, { label: "Outcome", value: "Qualified" }, { label: "When", value: "Today" }]));
    expect(card.links).toEqual([{ href: `/institutions/${INST}`, label: "Open the institution", ref: { kind: "institution", id: INST } }]);
  });
  it("shows a new deal with money in rupees and links it from the result", () => {
    const card = toDraftCard(row("create_deal", { institution_id: INST, institution_name: "St Mary's", kind: "fdp", title: "", value_inr: "250000", probability: "40", expected_close: "" }, { id: DEAL }), Date.now(), none);
    expect(card.rows).toEqual(expect.arrayContaining([{ label: "Type", value: "Faculty training" }, { label: "Title", value: "Faculty training - St Mary's" }, { label: "Win chance", value: "40%" }]));
    expect(card.rows.find((r) => r.label === "Value")?.value).toMatch(/2,50,000/);
    expect(card.links[0]?.href).toBe(`/sales/${DEAL}`);
  });
  it("shows a stage move and links the deal from the payload", () => {
    const card = toDraftCard(row("move_deal", { id: DEAL, deal_title: "W", from: "proposal", stage: "lost", lost_reason: "Budget", probability: "" }), Date.now(), none);
    expect(card.rows).toEqual(expect.arrayContaining([{ label: "From", value: "Proposal" }, { label: "To", value: "Lost" }, { label: "Reason", value: "Budget" }]));
    expect(card.links[0]?.href).toBe(`/sales/${DEAL}`);
  });
});
