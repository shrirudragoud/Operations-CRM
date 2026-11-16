import { z } from "zod";
import { todayIST } from "@/lib/format";
import { cleanSearch } from "@/lib/schemas/institution";

// Shared by the Sales forms and Server Actions. The database re-validates everything: the stage
// machine and "only the founder marks Won" live in ops.deal_transition, value/won-deal locks in
// ops.deal_guard (0016), one open deal per type in the deal_one_open_per_kind index (0014).

export const DEAL_KINDS = ["workshop", "fdp", "lab_setup", "other"] as const;
export type DealKind = (typeof DEAL_KINDS)[number];
export const DEAL_KIND_LABELS: Record<DealKind, string> = {
  workshop: "Workshop",
  fdp: "Faculty training",
  lab_setup: "Lab deal",
  other: "Other",
};

export const DEAL_STAGES = ["meeting", "proposal", "negotiation", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  meeting: "Meeting",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};
export const OPEN_STAGES = ["meeting", "proposal", "negotiation"] as const satisfies readonly DealStage[];

/** Suggested win probability (%) per stage; used to prefill forms, never applied silently. */
export const STAGE_PROBABILITY: Record<DealStage, number> = { meeting: 10, proposal: 40, negotiation: 70, won: 100, lost: 0 };

const TRANSITIONS: Record<DealStage, readonly DealStage[]> = {
  meeting: ["proposal", "lost"],
  proposal: ["meeting", "negotiation", "lost"],
  negotiation: ["proposal", "won", "lost"],
  won: [],
  lost: ["meeting"],
};

/** Mirrors ops.deal_transition. Won is listed here; the UI offers it to the founder only. */
export function allowedMoves(from: DealStage): readonly DealStage[] {
  return TRANSITIONS[from];
}

export function isOpenStage(stage: string): boolean {
  return (OPEN_STAGES as readonly string[]).includes(stage);
}

/** What the database creates when a deal of this type is won (ops.on_deal_won), in plain words. */
export function wonOutcome(kind: DealKind): string[] {
  if (kind === "workshop" || kind === "fdp") {
    return ["A draft event for Workshop to schedule", "A task for Training to assign a trainer", "A task for Workshop to reserve kits"];
  }
  if (kind === "lab_setup") return ["A task for Workshop to plan the lab setup"];
  return ["A task for Sales to plan delivery"];
}

export function defaultDealTitle(kind: DealKind, institutionName: string): string {
  return `${DEAL_KIND_LABELS[kind]} - ${institutionName}`.slice(0, 200);
}

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const MAX_VALUE = 9_999_999_999;

const money = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{1,10}(\.\d{1,2})?$/.test(v), "Enter an amount in rupees, like 25000.")
  .transform((v) => (v === "" ? 0 : Number(v)))
  .refine((v) => v <= MAX_VALUE, "That amount is too large.");

const probability = z
  .string()
  .trim()
  .refine((v) => v === "" || (/^\d{1,3}$/.test(v) && Number(v) <= 100), "Enter a whole number from 0 to 100.")
  .transform((v) => (v === "" ? null : Number(v)));

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || ymd.test(v), "Enter a valid date.")
  .transform((v) => (v === "" ? null : v));

const owner = z.union([z.literal(""), z.uuid()]).transform((v) => (v === "" ? null : v));

const detailFields = {
  value_inr: money,
  probability,
  expected_close: optionalDate,
  owner_id: owner,
};

export const dealSchema = z.object({
  institution_id: z.uuid({ message: "Choose an institution." }),
  kind: z.enum(DEAL_KINDS, { message: "Choose the deal type." }),
  title: z.string().trim().max(200, "Keep the title under 200 characters."),
  ...detailFields,
});
export type DealInput = z.input<typeof dealSchema>;
export type DealValues = z.output<typeof dealSchema>;

export const updateDealSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, "Enter a title.").max(200, "Keep the title under 200 characters."),
  ...detailFields,
});
export type UpdateDealInput = z.input<typeof updateDealSchema>;

export const dealIdSchema = z.object({ id: z.uuid() });

export const moveDealSchema = z
  .object({
    id: z.uuid(),
    stage: z.enum(DEAL_STAGES, { message: "Choose a stage." }),
    lost_reason: z.string().trim().max(500, "Keep the reason under 500 characters."),
    probability,
  })
  .superRefine((v, ctx) => {
    if (v.stage === "lost" && v.lost_reason === "") {
      ctx.addIssue({ code: "custom", path: ["lost_reason"], message: "Say why the deal was lost." });
    }
  });
export type MoveDealInput = z.input<typeof moveDealSchema>;

const quantity = z
  .string()
  .trim()
  .refine((v) => /^\d{1,7}(\.\d{1,3})?$/.test(v) && Number(v) > 0, "Enter a quantity above zero.")
  .transform(Number);

export const dealLineSchema = z.object({
  description: z.string().trim().min(1, "Describe the line.").max(200, "Keep it under 200 characters."),
  qty: quantity,
  unit_price_inr: money,
});
export type DealLineInput = z.input<typeof dealLineSchema>;
export type DealLineValues = z.output<typeof dealLineSchema>;

export const dealLinesSchema = z.object({
  deal_id: z.uuid(),
  lines: z.array(dealLineSchema).max(100, "A deal can have at most 100 lines."),
});
export type DealLinesInput = z.input<typeof dealLinesSchema>;

export function lineTotal(line: { qty: number | string; unit_price_inr: number | string }): number {
  return Math.round(Number(line.qty) * Number(line.unit_price_inr) * 100) / 100;
}

export function linesTotal(lines: { qty: number | string; unit_price_inr: number | string }[]): number {
  return Math.round(lines.reduce((sum, l) => sum + lineTotal(l), 0) * 100) / 100;
}

export function weightedValue(value: number | string | null, probabilityPct: number | null): number {
  return Math.round(Number(value ?? 0) * ((probabilityPct ?? 0) / 100) * 100) / 100;
}

/** An open deal is overdue when it expected to close before today (India date). */
export function isOverdue(expectedClose: string | null, stage: string, today: string = todayIST()): boolean {
  return !!expectedClose && isOpenStage(stage) && expectedClose < today;
}

// ---------------------------------------------------------------- Sales URL state

export const SALES_TABS = ["pipeline", "reports", "partners"] as const;
export type SalesTab = (typeof SALES_TABS)[number];
export const SALES_TAB_LABELS: Record<SalesTab, string> = { pipeline: "Pipeline", reports: "Forecast and reports", partners: "Partners" };

export type SalesParams = {
  tab: SalesTab;
  kind: "" | DealKind;
  segment: "" | "school" | "college" | "other";
  scope: "mine" | "all";
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseSalesParams(raw: Record<string, string | string[] | undefined>): SalesParams {
  const tab = first(raw.tab);
  const kind = first(raw.kind);
  const segment = cleanSearch(first(raw.segment));
  return {
    tab: (SALES_TABS as readonly string[]).includes(tab) ? (tab as SalesTab) : "pipeline",
    kind: (DEAL_KINDS as readonly string[]).includes(kind) ? (kind as DealKind) : "",
    segment: segment === "school" || segment === "college" || segment === "other" ? segment : "",
    scope: first(raw.scope) === "mine" ? "mine" : "all",
  };
}

export function salesQuery(p: Partial<SalesParams>): string {
  const qs = new URLSearchParams();
  if (p.tab && p.tab !== "pipeline") qs.set("tab", p.tab);
  if (p.kind) qs.set("kind", p.kind);
  if (p.segment) qs.set("segment", p.segment);
  if (p.scope === "mine") qs.set("scope", "mine");
  return qs.toString();
}
