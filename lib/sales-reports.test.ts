import { describe, expect, it } from "vitest";
import { byKind, byStage, forecastByMonth, funnelMatrix, openTotals, partnerScorecards, wonTotals, type PipelineRow } from "./sales-reports";

const row = (kind: string, segment: string, stage: string, deals: number, value: number, weighted: number): PipelineRow => ({
  kind, segment, stage, deals, value_inr: value, weighted_inr: weighted,
});
const rows = [
  row("workshop", "school", "meeting", 2, 10000, 1000),
  row("workshop", "college", "proposal", 1, 50000, 20000),
  row("lab_setup", "college", "negotiation", 1, 200000, 140000),
  row("workshop", "school", "won", 3, 90000, 90000),
  row("fdp", "college", "lost", 1, 5000, 0),
];

describe("pipeline totals", () => {
  it("sums only open stages for the forecast", () => {
    expect(openTotals(rows)).toEqual({ deals: 4, value: 260000, weighted: 161000 });
  });
  it("sums Won separately", () => {
    expect(wonTotals(rows)).toEqual({ deals: 3, value: 90000, weighted: 90000 });
  });
  it("splits by stage for one deal type", () => {
    const s = byStage(rows, "workshop");
    expect(Object.keys(s).sort()).toEqual(["meeting", "proposal", "won"]);
    expect(s.meeting?.deals).toBe(2);
  });
  it("splits open deals by type", () => {
    const k = byKind(rows, (st) => ["meeting", "proposal", "negotiation"].includes(st));
    expect(k.workshop?.deals).toBe(3);
    expect(k.lab_setup?.value).toBe(200000);
    expect(k.fdp).toBeUndefined();
  });
});

describe("forecastByMonth", () => {
  it("groups by close month, undated last", () => {
    const r = forecastByMonth([
      { expected_close: "2026-12-05", value_inr: 1000, probability: 50 },
      { expected_close: "2026-11-30", value_inr: 2000, probability: 10 },
      { expected_close: "2026-12-20", value_inr: 3000, probability: null },
      { expected_close: null, value_inr: 500, probability: 100 },
    ]);
    expect(r.map((m) => m.month)).toEqual(["2026-11", "2026-12", null]);
    expect(r[1]).toMatchObject({ deals: 2, value: 4000, weighted: 500 });
    expect(r[2]).toMatchObject({ deals: 1, weighted: 500 });
  });
});

describe("funnelMatrix", () => {
  it("lists every lifecycle stage in order with segment columns", () => {
    const m = funnelMatrix([
      { segment: "school", stage: "prospect", institutions: 5 },
      { segment: "college", stage: "prospect", institutions: 3 },
      { segment: "college", stage: "qualified", institutions: 2 },
    ]);
    expect(m[0]).toEqual({ stage: "prospect", school: 5, college: 3, other: 0, total: 8 });
    expect(m.find((x) => x.stage === "qualified")?.total).toBe(2);
    expect(m).toHaveLength(10);
  });
});

describe("partnerScorecards", () => {
  it("counts open, won and lost per partner", () => {
    const m = partnerScorecards([
      { owner_id: "a", stage: "meeting", value_inr: 100 },
      { owner_id: "a", stage: "won", value_inr: 500 },
      { owner_id: "a", stage: "lost", value_inr: 50 },
      { owner_id: "b", stage: "won", value_inr: 200 },
    ]);
    expect(m.get("a")).toMatchObject({ open: 1, openValue: 100, won: 1, wonValue: 500, lost: 1 });
    expect(m.get("b")).toMatchObject({ won: 1, wonValue: 200 });
  });
});
