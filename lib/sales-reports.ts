import { isOpenStage, weightedValue } from "@/lib/schemas/deal";
import { STAGES, type Stage } from "@/lib/schemas/institution";

// Pure aggregation for the Sales reports tab. Inputs come from v_pipeline, v_funnel and the open
// deals list; keeping the maths here makes it unit-testable without a database.

export type PipelineRow = {
  kind: string | null;
  segment: string | null;
  stage: string | null;
  deals: number | null;
  value_inr: number | string | null;
  weighted_inr: number | string | null;
};

export type Totals = { deals: number; value: number; weighted: number };

const empty = (): Totals => ({ deals: 0, value: 0, weighted: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;

function add(t: Totals, r: PipelineRow) {
  t.deals += r.deals ?? 0;
  t.value = round2(t.value + Number(r.value_inr ?? 0));
  t.weighted = round2(t.weighted + Number(r.weighted_inr ?? 0));
}

/** Open pipeline: deals, value and probability-weighted value across Meeting, Proposal and Negotiation. */
export function openTotals(rows: PipelineRow[]): Totals {
  const t = empty();
  for (const r of rows) if (r.stage && isOpenStage(r.stage)) add(t, r);
  return t;
}

export function wonTotals(rows: PipelineRow[]): Totals {
  const t = empty();
  for (const r of rows) if (r.stage === "won") add(t, r);
  return t;
}

/** Totals for one deal type, split by stage. */
export function byStage(rows: PipelineRow[], kind?: string): Record<string, Totals> {
  const out: Record<string, Totals> = {};
  for (const r of rows) {
    if (!r.stage || (kind && r.kind !== kind)) continue;
    add((out[r.stage] ??= empty()), r);
  }
  return out;
}

export function byKind(rows: PipelineRow[], stages: (s: string) => boolean): Record<string, Totals> {
  const out: Record<string, Totals> = {};
  for (const r of rows) {
    if (!r.kind || !r.stage || !stages(r.stage)) continue;
    add((out[r.kind] ??= empty()), r);
  }
  return out;
}

export type ForecastDeal = { expected_close: string | null; value_inr: number | string | null; probability: number | null };
export type ForecastMonth = { month: string | null; deals: number; value: number; weighted: number };

/** Open deals grouped by expected close month (yyyy-mm), earliest first; deals with no date come last (month = null). */
export function forecastByMonth(deals: ForecastDeal[]): ForecastMonth[] {
  const map = new Map<string | null, ForecastMonth>();
  for (const d of deals) {
    const month = d.expected_close ? d.expected_close.slice(0, 7) : null;
    const m = map.get(month) ?? { month, deals: 0, value: 0, weighted: 0 };
    m.deals += 1;
    m.value = round2(m.value + Number(d.value_inr ?? 0));
    m.weighted = round2(m.weighted + weightedValue(d.value_inr, d.probability));
    map.set(month, m);
  }
  return [...map.values()].sort((a, b) => (a.month === null ? 1 : b.month === null ? -1 : a.month.localeCompare(b.month)));
}

export type FunnelRow = { segment: string | null; stage: string | null; institutions: number | null };
export const FUNNEL_SEGMENTS = ["school", "college", "other"] as const;

/** Institutions per lifecycle stage (in order) and segment, with a total column. */
export function funnelMatrix(rows: FunnelRow[]): { stage: Stage; school: number; college: number; other: number; total: number }[] {
  return STAGES.map((stage) => {
    const line = { stage, school: 0, college: 0, other: 0, total: 0 };
    for (const r of rows) {
      if (r.stage !== stage || !r.segment || !(FUNNEL_SEGMENTS as readonly string[]).includes(r.segment)) continue;
      line[r.segment as (typeof FUNNEL_SEGMENTS)[number]] += r.institutions ?? 0;
      line.total += r.institutions ?? 0;
    }
    return line;
  });
}

export type ScorecardDeal = { owner_id: string; stage: string; value_inr: number | string | null };
export type Scorecard = { owner_id: string; open: number; openValue: number; won: number; wonValue: number; lost: number };

export function partnerScorecards(deals: ScorecardDeal[]): Map<string, Scorecard> {
  const map = new Map<string, Scorecard>();
  for (const d of deals) {
    const s = map.get(d.owner_id) ?? { owner_id: d.owner_id, open: 0, openValue: 0, won: 0, wonValue: 0, lost: 0 };
    const v = Number(d.value_inr ?? 0);
    if (isOpenStage(d.stage)) {
      s.open += 1;
      s.openValue = round2(s.openValue + v);
    } else if (d.stage === "won") {
      s.won += 1;
      s.wonValue = round2(s.wonValue + v);
    } else if (d.stage === "lost") {
      s.lost += 1;
    }
    map.set(d.owner_id, s);
  }
  return map;
}
