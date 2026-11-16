import { describe, expect, it } from "vitest";
import { canArchiveDeal, canArchiveEvent, canEditDeal, canManageEvents, canManageDeals, canMarkDealWon, canMoveDeal, type Me } from "./permissions";

const ME_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const me = (role: Me["role"], departments: Me["departments"] = []): Me => ({
  id: ME_ID, full_name: "Test", email: "t@example.in", role, departments,
});
const deal = (stage: string, owner_id = OTHER_ID) => ({ stage, owner_id });

describe("canManageDeals (deal_ins / deal_upd)", () => {
  it("allows founder, Sales writers and partners", () => {
    expect(canManageDeals(me("founder"))).toBe(true);
    expect(canManageDeals(me("member", ["sales"]))).toBe(true);
    expect(canManageDeals(me("partner"))).toBe(true);
  });
  it("refuses other departments, viewers and signed-out users", () => {
    expect(canManageDeals(me("member", ["outreach", "workshop"]))).toBe(false);
    expect(canManageDeals(me("viewer", ["sales"]))).toBe(false);
    expect(canManageDeals(null)).toBe(false);
  });
});

describe("canEditDeal", () => {
  it("lets Sales edit open deals only", () => {
    const m = me("member", ["sales"]);
    for (const s of ["meeting", "proposal", "negotiation"]) expect(canEditDeal(m, deal(s)), s).toBe(true);
    expect(canEditDeal(m, deal("lost"))).toBe(false);
    expect(canEditDeal(m, deal("won"))).toBe(false);
  });
  it("keeps Won deals founder-only (ops.deal_guard)", () => {
    expect(canEditDeal(me("founder"), deal("won"))).toBe(true);
    expect(canEditDeal(me("dept_lead", ["sales"]), deal("won"))).toBe(false);
    expect(canEditDeal(me("partner"), deal("won", ME_ID))).toBe(false);
  });
  it("limits a partner to their own deals", () => {
    expect(canEditDeal(me("partner"), deal("meeting", ME_ID))).toBe(true);
    expect(canEditDeal(me("partner"), deal("meeting", OTHER_ID))).toBe(false);
  });
});

describe("canMoveDeal", () => {
  it("allows moving open and lost deals, never a Won one", () => {
    const m = me("member", ["sales"]);
    expect(canMoveDeal(m, deal("meeting"))).toBe(true);
    expect(canMoveDeal(m, deal("lost"))).toBe(true);
    expect(canMoveDeal(m, deal("won"))).toBe(false);
    expect(canMoveDeal(me("founder"), deal("won"))).toBe(false);
  });
  it("refuses viewers and other people's deals for partners", () => {
    expect(canMoveDeal(me("viewer", ["sales"]), deal("meeting"))).toBe(false);
    expect(canMoveDeal(me("partner"), deal("meeting", OTHER_ID))).toBe(false);
    expect(canMoveDeal(me("partner"), deal("meeting", ME_ID))).toBe(true);
  });
});

describe("canArchiveDeal / canMarkDealWon", () => {
  it("archive is for the founder and Sales leads", () => {
    expect(canArchiveDeal(me("founder"))).toBe(true);
    expect(canArchiveDeal(me("dept_lead", ["sales"]))).toBe(true);
    expect(canArchiveDeal(me("dept_lead", ["workshop"]))).toBe(false);
    expect(canArchiveDeal(me("member", ["sales"]))).toBe(false);
    expect(canArchiveDeal(me("partner"))).toBe(false);
  });
  it("only the founder marks a deal Won (D7)", () => {
    expect(canMarkDealWon(me("founder"))).toBe(true);
    expect(canMarkDealWon(me("dept_lead", ["sales"]))).toBe(false);
    expect(canMarkDealWon(me("partner"))).toBe(false);
  });
});

describe("events (event_upd, run_sheet_item_upd, set_event_team)", () => {
  it("lets Workshop writers and the founder manage events", () => {
    expect(canManageEvents(me("founder"))).toBe(true);
    expect(canManageEvents(me("member", ["workshop"]))).toBe(true);
  });
  it("keeps Sales, Training, Community, viewers and partners read-only", () => {
    for (const dept of ["sales", "training", "community"] as const) expect(canManageEvents(me("member", [dept]))).toBe(false);
    expect(canManageEvents(me("viewer", ["workshop"]))).toBe(false);
    expect(canManageEvents(me("partner"))).toBe(false);
    expect(canManageEvents(null)).toBe(false);
  });
  it("limits archiving to the founder and Workshop leads", () => {
    expect(canArchiveEvent(me("founder"))).toBe(true);
    expect(canArchiveEvent(me("dept_lead", ["workshop"]))).toBe(true);
    expect(canArchiveEvent(me("member", ["workshop"]))).toBe(false);
    expect(canArchiveEvent(me("dept_lead", ["sales"]))).toBe(false);
  });
});
