import { describe, expect, it } from "vitest";
import { changeText, cockpitQuery, funnelSteps, kitLoss, parseCockpitParams, trend, type FunnelRow } from "./cockpit";

const rows: FunnelRow[] = [
  { segment: "school", ord: 1, step: "contacted", label: "Contacted", institutions: 10 },
  { segment: "school", ord: 2, step: "qualified", label: "Qualified", institutions: 5 },
  { segment: "school", ord: 3, step: "deal_won", label: "Deal won", institutions: 0 },
  { segment: "college", ord: 1, step: "contacted", label: "Contacted", institutions: 6 },
  { segment: "college", ord: 2, step: "qualified", label: "Qualified", institutions: 3 },
  { segment: "college", ord: 3, step: "deal_won", label: "Deal won", institutions: 1 },
];

describe("parseCockpitParams", () => {
  it("defaults to the fundraising view and all segments", () => {
    expect(parseCockpitParams({})).toEqual({ view: "fundraising", segment: "all" });
  });
  it("ignores values it does not know", () => {
    expect(parseCockpitParams({ view: "admin", segment: "x" })).toEqual({ view: "fundraising", segment: "all" });
  });
  it("takes the first of a repeated value", () => {
    expect(parseCockpitParams({ view: ["operations", "fundraising"], segment: "school" })).toEqual({ view: "operations", segment: "school" });
  });
  it("leaves defaults out of the query string", () => {
    expect(cockpitQuery({ view: "fundraising", segment: "all" })).toBe("");
    expect(cockpitQuery({ view: "operations", segment: "school" })).toBe("view=operations&segment=school");
  });
});

describe("funnelSteps", () => {
  it("adds the segments together for all", () => {
    const s = funnelSteps(rows, "all");
    expect(s.map((x) => x.count)).toEqual([16, 8, 1]);
  });
  it("gives the share that carried on from the step before and from the top", () => {
    const s = funnelSteps(rows, "all");
    expect(s[0]).toMatchObject({ fromPrevious: null, fromTop: null });
    expect(s[1]).toMatchObject({ fromPrevious: 50, fromTop: 50 });
    expect(s[2]).toMatchObject({ fromPrevious: 13, fromTop: 6 });
  });
  it("filters to one segment", () => {
    expect(funnelSteps(rows, "school").map((x) => x.count)).toEqual([10, 5, 0]);
  });
  it("has no percentage when the step before is empty", () => {
    const s = funnelSteps([
      { segment: "other", ord: 1, step: "contacted", label: "Contacted", institutions: 0 },
      { segment: "other", ord: 2, step: "qualified", label: "Qualified", institutions: 0 },
    ], "other");
    expect(s[1]?.fromPrevious).toBeNull();
  });
  it("orders by step number whatever order the rows came in", () => {
    expect(funnelSteps([...rows].reverse(), "all").map((x) => x.step)).toEqual(["contacted", "qualified", "deal_won"]);
  });
  it("is empty with no rows", () => {
    expect(funnelSteps([], "all")).toEqual([]);
  });
});

describe("trend", () => {
  it("has nothing with no snapshots", () => {
    expect(trend([])).toEqual({ latest: null, earlier: null, change: null, since: null });
  });
  it("shows no change with a single day of history", () => {
    expect(trend([{ snapshot_date: "2026-11-18", value: 5 }])).toEqual({ latest: 5, earlier: null, change: null, since: null });
  });
  it("compares with the day a week earlier", () => {
    const t = trend([
      { snapshot_date: "2026-11-10", value: 4 },
      { snapshot_date: "2026-11-11", value: 9 },
      { snapshot_date: "2026-11-17", value: 10 },
      { snapshot_date: "2026-11-18", value: 12 },
    ]);
    expect(t).toEqual({ latest: 12, earlier: 9, change: 3, since: "2026-11-11" });
  });
  it("uses the oldest day when there is less than a week of history", () => {
    const t = trend([
      { snapshot_date: "2026-11-16", value: "100" },
      { snapshot_date: "2026-11-18", value: "80" },
    ]);
    expect(t).toEqual({ latest: 80, earlier: 100, change: -20, since: "2026-11-16" });
  });
  it("copes with rows out of order", () => {
    const t = trend([
      { snapshot_date: "2026-11-18", value: 2 },
      { snapshot_date: "2026-11-01", value: 1 },
    ]);
    expect(t.change).toBe(1);
  });
});

describe("kitLoss", () => {
  const pcb = { id: "a", name: "PCB", sku: "P1", unit_cost_inr: "250.50" };
  const cable = { id: "b", name: "Cable", sku: null, unit_cost_inr: 20 };
  const bare = { id: "c", name: "Bare", sku: null, unit_cost_inr: null };
  it("prices damaged and lost units, ignoring other movements", () => {
    const k = kitLoss([
      { kind: "damaged", qty: -2, item: pcb },
      { kind: "lost", qty: -1, item: pcb },
      { kind: "issued", qty: -5, item: pcb },
      { kind: "lost", qty: -3, item: cable },
    ]);
    expect(k.total).toBe(811.5);
    expect(k.units).toBe(6);
    expect(k.byItem.map((i) => i.name)).toEqual(["PCB", "Cable"]);
  });
  it("counts units with no price instead of guessing a cost", () => {
    const k = kitLoss([{ kind: "lost", qty: -4, item: bare }]);
    expect(k).toMatchObject({ total: 0, units: 4, unpriced: 4 });
  });
  it("is zero with nothing lost", () => {
    expect(kitLoss([])).toEqual({ total: 0, units: 0, byItem: [], unpriced: 0 });
  });
});

describe("changeText", () => {
  it("signs the change", () => {
    expect(changeText(3)).toBe("+3");
    expect(changeText(-1200)).toBe("-1,200");
    expect(changeText(0)).toBe("no change");
    expect(changeText(null)).toBeNull();
  });
});
