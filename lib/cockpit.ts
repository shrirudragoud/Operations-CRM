// Cockpit maths (D57, D59): pure, so it is unit-tested without a database.

export const COCKPIT_VIEWS = ["fundraising", "operations"] as const;
export type CockpitView = (typeof COCKPIT_VIEWS)[number];
export const COCKPIT_VIEW_LABELS: Record<CockpitView, string> = { fundraising: "Fundraising", operations: "Operations" };

export const COCKPIT_SEGMENTS = ["all", "school", "college", "other"] as const;
export type CockpitSegment = (typeof COCKPIT_SEGMENTS)[number];
export const COCKPIT_SEGMENT_LABELS: Record<CockpitSegment, string> = { all: "All", school: "Schools", college: "Colleges", other: "Other" };

export type CockpitParams = { view: CockpitView; segment: CockpitSegment };

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseCockpitParams(raw: Record<string, string | string[] | undefined>): CockpitParams {
  const view = one(raw.view);
  const segment = one(raw.segment);
  return {
    view: COCKPIT_VIEWS.find((v) => v === view) ?? "fundraising",
    segment: COCKPIT_SEGMENTS.find((s) => s === segment) ?? "all",
  };
}

export function cockpitQuery(p: CockpitParams): string {
  const q = new URLSearchParams();
  if (p.view !== "fundraising") q.set("view", p.view);
  if (p.segment !== "all") q.set("segment", p.segment);
  return q.toString();
}

export type FunnelRow = { segment: string | null; ord: number | null; step: string | null; label: string | null; institutions: number | null };
export type FunnelStep = {
  step: string;
  label: string;
  count: number;
  /** Share of the step before it that got here (percent, whole number); null for the first step or when the one before is empty. */
  fromPrevious: number | null;
  /** Share of the first step. */
  fromTop: number | null;
};

/** The steps in order for one segment (or all of them added together), with how many carried on from the step before. */
export function funnelSteps(rows: FunnelRow[], segment: CockpitSegment): FunnelStep[] {
  const byStep = new Map<number, { step: string; label: string; count: number }>();
  for (const r of rows) {
    if (r.ord === null || !r.step || !r.label) continue;
    if (segment !== "all" && r.segment !== segment) continue;
    const cur = byStep.get(r.ord) ?? { step: r.step, label: r.label, count: 0 };
    cur.count += r.institutions ?? 0;
    byStep.set(r.ord, cur);
  }
  const ordered = [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const top = ordered[0]?.count ?? 0;
  return ordered.map((s, i) => {
    const prev = i > 0 ? (ordered[i - 1]?.count ?? 0) : 0;
    return {
      ...s,
      fromPrevious: i > 0 && prev > 0 ? Math.round((s.count / prev) * 100) : null,
      fromTop: i > 0 && top > 0 ? Math.round((s.count / top) * 100) : null,
    };
  });
}

export type SnapshotRow = { snapshot_date: string; value: number | string };
export type Trend = {
  latest: number | null;
  /** The value `days` earlier, or the oldest value we have if there is less history than that. */
  earlier: number | null;
  change: number | null;
  /** The date `earlier` is from, so the page can say what the change is measured against. */
  since: string | null;
};

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Change over about `days` for one metric, from nightly snapshot rows. With one day of history there is no change to show. */
export function trend(rows: SnapshotRow[], days = 7): Trend {
  const sorted = [...rows].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const last = sorted[sorted.length - 1];
  if (!last) return { latest: null, earlier: null, change: null, since: null };
  const target = shiftDate(last.snapshot_date, -days);
  const older = sorted.filter((r) => r.snapshot_date <= target);
  const base = older[older.length - 1] ?? sorted[0];
  if (!base || base.snapshot_date === last.snapshot_date) return { latest: Number(last.value), earlier: null, change: null, since: null };
  return { latest: Number(last.value), earlier: Number(base.value), change: Number(last.value) - Number(base.value), since: base.snapshot_date };
}

export type KitMovement = { kind: string; qty: number; item: { id: string; name: string; sku: string | null; unit_cost_inr: number | string | null } | null };
export type KitLoss = { total: number; units: number; byItem: { id: string; name: string; sku: string | null; units: number; cost: number }[]; unpriced: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What damaged and lost kit has cost. Items with no unit cost add units but no rupees, and are counted so the page can say so. */
export function kitLoss(movements: KitMovement[]): KitLoss {
  const items = new Map<string, KitLoss["byItem"][number]>();
  let unpriced = 0;
  for (const m of movements) {
    if ((m.kind !== "damaged" && m.kind !== "lost") || !m.item) continue;
    const units = Math.abs(m.qty);
    const unit = m.item.unit_cost_inr === null ? null : Number(m.item.unit_cost_inr);
    const cur = items.get(m.item.id) ?? { id: m.item.id, name: m.item.name, sku: m.item.sku, units: 0, cost: 0 };
    cur.units += units;
    cur.cost = round2(cur.cost + units * (unit ?? 0));
    if (unit === null || unit === 0) unpriced += units;
    items.set(m.item.id, cur);
  }
  const byItem = [...items.values()].sort((a, b) => b.cost - a.cost || b.units - a.units);
  return { total: round2(byItem.reduce((s, i) => s + i.cost, 0)), units: byItem.reduce((s, i) => s + i.units, 0), byItem, unpriced };
}

/** "+12", "-3", "no change". */
export function changeText(change: number | null): string | null {
  if (change === null) return null;
  if (change === 0) return "no change";
  return `${change > 0 ? "+" : "-"}${Math.abs(change).toLocaleString("en-IN")}`;
}
