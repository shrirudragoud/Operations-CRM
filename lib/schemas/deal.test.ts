import { describe, expect, it } from "vitest";
import {
  allowedMoves, dealLinesSchema, dealSchema, defaultDealTitle, isOverdue, linesTotal, moveDealSchema,
  parseSalesParams, salesQuery, updateDealSchema, weightedValue, wonOutcome,
} from "./deal";

const ID = "00000000-0000-4000-8000-000000000001";

describe("dealSchema", () => {
  const base = { institution_id: ID, kind: "workshop", title: "", value_inr: "", probability: "", expected_close: "", owner_id: "" };
  it("accepts a minimal deal and turns blanks into 0 / null", () => {
    const r = dealSchema.parse(base);
    expect(r).toMatchObject({ value_inr: 0, probability: null, expected_close: null, owner_id: null, title: "" });
  });
  it("parses money, probability and dates", () => {
    const r = dealSchema.parse({ ...base, value_inr: "25000.50", probability: "40", expected_close: "2026-12-31" });
    expect(r).toMatchObject({ value_inr: 25000.5, probability: 40, expected_close: "2026-12-31" });
  });
  it("rejects the old bundle type, negatives, bad probability and absurd amounts", () => {
    expect(dealSchema.safeParse({ ...base, kind: "bundle" }).success).toBe(false);
    expect(dealSchema.safeParse({ ...base, value_inr: "-5" }).success).toBe(false);
    expect(dealSchema.safeParse({ ...base, value_inr: "12.345" }).success).toBe(false);
    expect(dealSchema.safeParse({ ...base, value_inr: "99999999999" }).success).toBe(false);
    expect(dealSchema.safeParse({ ...base, probability: "101" }).success).toBe(false);
    expect(dealSchema.safeParse({ ...base, probability: "4.5" }).success).toBe(false);
    expect(dealSchema.safeParse({ ...base, expected_close: "31/12/2026" }).success).toBe(false);
  });
});

describe("updateDealSchema", () => {
  it("needs a title", () => {
    expect(updateDealSchema.safeParse({ id: ID, title: " ", value_inr: "", probability: "", expected_close: "", owner_id: "" }).success).toBe(false);
  });
});

describe("moveDealSchema", () => {
  it("requires a reason when the deal is lost", () => {
    const r = moveDealSchema.safeParse({ id: ID, stage: "lost", lost_reason: "  ", probability: "" });
    expect(r.success).toBe(false);
    expect(moveDealSchema.safeParse({ id: ID, stage: "lost", lost_reason: "Budget", probability: "" }).success).toBe(true);
  });
  it("does not need one for other stages", () => {
    expect(moveDealSchema.safeParse({ id: ID, stage: "proposal", lost_reason: "", probability: "40" }).success).toBe(true);
  });
});

describe("deal lines", () => {
  it("parses quantity and unit price", () => {
    const r = dealLinesSchema.parse({ deal_id: ID, lines: [{ description: "Kit", qty: "10", unit_price_inr: "500" }] });
    expect(r.lines[0]).toEqual({ description: "Kit", qty: 10, unit_price_inr: 500 });
  });
  it("refuses zero quantity, blank description and negative price", () => {
    expect(dealLinesSchema.safeParse({ deal_id: ID, lines: [{ description: "Kit", qty: "0", unit_price_inr: "1" }] }).success).toBe(false);
    expect(dealLinesSchema.safeParse({ deal_id: ID, lines: [{ description: " ", qty: "1", unit_price_inr: "1" }] }).success).toBe(false);
    expect(dealLinesSchema.safeParse({ deal_id: ID, lines: [{ description: "x", qty: "1", unit_price_inr: "-1" }] }).success).toBe(false);
  });
  it("totals lines without float drift", () => {
    expect(linesTotal([{ qty: 3, unit_price_inr: 0.1 }, { qty: "2", unit_price_inr: "19.99" }])).toBe(40.28);
  });
});

describe("stage machine (mirrors ops.deal_transition)", () => {
  it("matches the database table", () => {
    expect(allowedMoves("meeting")).toEqual(["proposal", "lost"]);
    expect(allowedMoves("proposal")).toEqual(["meeting", "negotiation", "lost"]);
    expect(allowedMoves("negotiation")).toEqual(["proposal", "won", "lost"]);
    expect(allowedMoves("lost")).toEqual(["meeting"]);
    expect(allowedMoves("won")).toEqual([]);
  });
});

describe("helpers", () => {
  it("describes what winning creates per type", () => {
    expect(wonOutcome("workshop")).toHaveLength(3);
    expect(wonOutcome("fdp")).toHaveLength(3);
    expect(wonOutcome("lab_setup")).toHaveLength(1);
    expect(wonOutcome("other")).toEqual(["A task for Sales to plan delivery"]);
  });
  it("builds the default title", () => {
    expect(defaultDealTitle("fdp", "ZZ College")).toBe("Faculty training - ZZ College");
  });
  it("weights by probability, treating none as 0", () => {
    expect(weightedValue(10000, 40)).toBe(4000);
    expect(weightedValue("10000", null)).toBe(0);
  });
  it("flags only open deals past their close date", () => {
    expect(isOverdue("2026-01-01", "proposal", "2026-02-01")).toBe(true);
    expect(isOverdue("2026-03-01", "proposal", "2026-02-01")).toBe(false);
    expect(isOverdue("2026-01-01", "won", "2026-02-01")).toBe(false);
    expect(isOverdue(null, "meeting", "2026-02-01")).toBe(false);
  });
});

describe("Sales URL params", () => {
  it("falls back to safe defaults", () => {
    expect(parseSalesParams({ tab: "x", kind: "bundle", segment: "zzz", scope: "weird" })).toEqual({ tab: "pipeline", kind: "", segment: "", scope: "all" });
  });
  it("round-trips", () => {
    const p = parseSalesParams({ tab: "reports", kind: "lab_setup", segment: "college", scope: "mine" });
    expect(parseSalesParams(Object.fromEntries(new URLSearchParams(salesQuery(p))))).toEqual(p);
  });
});
