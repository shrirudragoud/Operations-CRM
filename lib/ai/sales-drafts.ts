// Outreach and deal drafts: checked with the same zod schemas the Sales and Outreach forms use, shown on a card, and run later
// through the same server actions. Values are kept as the form strings those actions take. Edit drafts keep only what changes.
// A draft never writes a stage by hand: logging activity lets the database move it, and Won is only ever marked by the founder.

import type { DealView } from "@/lib/ai/areas/sales";
import type { Checked } from "@/lib/ai/drafts";
import type { CardRow } from "@/lib/ai/types";
import { clip, dayLabel } from "@/lib/ai/when";
import { formatINR } from "@/lib/format";
import { canEditDeal, canMoveDeal, type Me } from "@/lib/permissions";
import { activitySchema, KIND_LABELS as ACTIVITY_LABELS, OUTCOME_LABELS } from "@/lib/schemas/activity";
import {
  allowedMoves, DEAL_KIND_LABELS, DEAL_STAGE_LABELS, dealSchema, defaultDealTitle, moveDealSchema, updateDealSchema,
  type DealKind, type DealStage,
} from "@/lib/schemas/deal";
import type { z } from "zod";

type Rec = Record<string, unknown>;

const asRecord = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const blankable = (v: unknown): string => (v === null ? "" : text(v));

function issues(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
}

export type InstitutionFacts = { name: string; archived: boolean; openDealKinds: string[] };

// ---------------------------------------------------------------- log activity

export function checkLogActivity(args: unknown, institution: InstitutionFacts | null): Checked {
  const a = asRecord(args);
  const input = {
    institution_id: a.institution_id,
    contact_id: "",
    kind: a.kind,
    outcome: blankable(a.outcome),
    notes: blankable(a.notes),
    happened_on: blankable(a.happened_on),
    next_step: blankable(a.next_step),
    next_step_due: blankable(a.next_step_due),
  };
  const r = activitySchema.safeParse(input);
  if (!r.success) return { ok: false, errors: issues(r.error) };
  if (!institution) return { ok: false, errors: ["institution_id: No institution with that id is visible to this person. Use search_institutions."] };
  if (institution.archived) return { ok: false, errors: ["institution_id: That institution is archived. It has to be restored before activity can be logged."] };
  const v = r.data;
  return {
    ok: true,
    payload: {
      institution_id: v.institution_id,
      institution_name: institution.name,
      kind: v.kind,
      outcome: v.outcome ?? "",
      notes: v.notes ?? "",
      happened_on: v.happened_on ?? "",
      next_step: v.next_step ?? "",
      next_step_due: v.next_step_due ?? "",
    },
  };
}

// ---------------------------------------------------------------- create deal

export function checkCreateDeal(args: unknown, institution: InstitutionFacts | null): Checked {
  const a = asRecord(args);
  const input = {
    institution_id: a.institution_id,
    kind: a.kind,
    title: blankable(a.title),
    value_inr: blankable(a.value_inr),
    probability: blankable(a.probability),
    expected_close: blankable(a.expected_close),
    owner_id: "",
  };
  const r = dealSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: issues(r.error) };
  if (!institution) return { ok: false, errors: ["institution_id: No institution with that id is visible to this person. Use search_institutions."] };
  if (institution.archived) return { ok: false, errors: ["institution_id: That institution is archived. It has to be restored before it can have a deal."] };
  if (institution.openDealKinds.includes(r.data.kind)) {
    return { ok: false, errors: [`kind: This institution already has an open ${DEAL_KIND_LABELS[r.data.kind]} deal. Move or close that one first (search_deals finds it).`] };
  }
  return {
    ok: true,
    payload: {
      institution_id: r.data.institution_id,
      institution_name: institution.name,
      kind: r.data.kind,
      title: r.data.title,
      value_inr: input.value_inr,
      probability: input.probability,
      expected_close: input.expected_close,
    },
  };
}

// ---------------------------------------------------------------- update deal

/** The deal as the edit form sees it: strings, empty for blanks. The owner is left alone (empty). */
export function dealFormValues(live: DealView) {
  return {
    id: live.id,
    title: live.title,
    value_inr: live.value_inr === null ? "" : String(live.value_inr),
    probability: live.probability === null ? "" : String(live.probability),
    expected_close: live.expected_close ? live.expected_close.slice(0, 10) : "",
    owner_id: "",
  };
}

/** The input updateDeal takes: the live deal with the drafted changes laid over it. */
export function mergeDeal(live: DealView, changes: Rec): Rec {
  return { ...dealFormValues(live), ...changes };
}

function dealBlocked(live: DealView, me: Me): string | null {
  if (live.archived) return "That deal is archived. It has to be restored on the Sales page first.";
  if (live.stage === "won") return "That deal is won. Only the founder can change a won deal, in the app.";
  if (live.stage === "lost") return "That deal is lost. Move it back to Meeting first, then edit it.";
  if (!canEditDeal(me, { stage: live.stage, owner_id: live.owner_id ?? "" })) return "Only the deal's owner can change this deal.";
  return null;
}

export function checkUpdateDeal(live: DealView, args: unknown, me: Me): Checked {
  const blocked = dealBlocked(live, me);
  if (blocked) return { ok: false, errors: [blocked] };
  const a = asRecord(args);
  const changes: Rec = {};
  if (a.title !== undefined) changes.title = text(a.title);
  if (a.value_inr !== undefined) changes.value_inr = blankable(a.value_inr);
  if (a.probability !== undefined) changes.probability = blankable(a.probability);
  if (a.expected_close !== undefined) changes.expected_close = blankable(a.expected_close);
  if (Object.keys(changes).length === 0) return { ok: false, errors: ["Say what to change: title, value_inr, probability or expected_close."] };
  const r = updateDealSchema.safeParse(mergeDeal(live, changes));
  if (!r.success) return { ok: false, errors: issues(r.error) };
  return { ok: true, payload: { id: live.id, deal_title: live.title, changes } };
}

// ---------------------------------------------------------------- move deal

export function checkMoveDeal(live: DealView, args: unknown, me: Me): Checked {
  const a = asRecord(args);
  if (a.stage === "won") {
    return { ok: false, errors: ["Only the founder can mark a deal Won, and only on the deal page: tell the person to do that there. Nothing was drafted."] };
  }
  if (live.archived) return { ok: false, errors: ["That deal is archived. It has to be restored on the Sales page first."] };
  if (!canMoveDeal(me, { stage: live.stage, owner_id: live.owner_id ?? "" })) {
    return { ok: false, errors: [live.stage === "won" ? "A won deal cannot change stage." : "Only the deal's owner can move this deal."] };
  }
  const input = { id: live.id, stage: a.stage, lost_reason: blankable(a.lost_reason), probability: blankable(a.probability) };
  const r = moveDealSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: issues(r.error) };
  const from = live.stage as DealStage;
  if (!allowedMoves(from).includes(r.data.stage)) {
    const next = allowedMoves(from).filter((s) => s !== "won").map((s) => DEAL_STAGE_LABELS[s]);
    return { ok: false, errors: [`A ${DEAL_STAGE_LABELS[from]} deal can only move to: ${next.length ? next.join(", ") : "nowhere"}.`] };
  }
  return {
    ok: true,
    payload: { id: live.id, deal_title: live.title, from, stage: r.data.stage, lost_reason: r.data.stage === "lost" ? input.lost_reason : "", probability: input.probability },
  };
}

// ---------------------------------------------------------------- what the person reads

const quoted = (v: unknown) => `"${clip(text(v), 80)}"`;
const label = <T extends string>(map: Record<T, string>, key: unknown): string => map[key as T] ?? text(key);
const day = (iso: string) => `${iso} (${dayLabel(iso)})`;
const rupees = (v: unknown) => (text(v) === "" ? "" : formatINR(Number(v)));

const CHANGE_LABEL: Record<string, string> = { title: "Title", value_inr: "Value", probability: "Win chance", expected_close: "Expected close" };

function changeValue(key: string, value: unknown): string {
  const v = text(value);
  if (!v) return "Cleared";
  if (key === "value_inr") return rupees(v);
  if (key === "probability") return `${v}%`;
  if (key === "expected_close") return day(v);
  return clip(v, 120);
}

export function summarizeSales(kind: string, p: Rec): string {
  switch (kind) {
    case "log_activity": {
      const outcome = text(p.outcome) ? `, ${label(OUTCOME_LABELS, p.outcome).toLowerCase()}` : "";
      return `Log ${label(ACTIVITY_LABELS, p.kind).toLowerCase()} with ${clip(text(p.institution_name), 80)}${outcome}${text(p.next_step) ? ` and a follow-up on ${text(p.next_step_due)}` : ""}`;
    }
    case "create_deal": {
      const title = text(p.title) || defaultDealTitle(p.kind as DealKind, text(p.institution_name));
      return `Open a ${label(DEAL_KIND_LABELS, p.kind).toLowerCase()} deal for ${clip(text(p.institution_name), 80)}: ${quoted(title)}`;
    }
    case "update_deal":
      return `Change ${Object.keys(asRecord(p.changes)).map((k) => (CHANGE_LABEL[k] ?? k).toLowerCase()).join(", ")} on ${quoted(p.deal_title)}`;
    default:
      return `Move ${quoted(p.deal_title)} from ${label(DEAL_STAGE_LABELS, p.from)} to ${label(DEAL_STAGE_LABELS, p.stage)}${p.stage === "lost" ? `: ${clip(text(p.lost_reason), 120)}` : ""}`;
  }
}

/** What happens beyond the row itself, so the person is not surprised. */
export function salesNotes(kind: string, p: Rec): string[] {
  const notes: string[] = [];
  if (kind === "log_activity") {
    if (p.outcome === "qualified") notes.push("Marking it Qualified opens a Workshop deal for this institution.");
    if (text(p.next_step)) notes.push("A follow-up task is created for the next step.");
  }
  if (kind === "move_deal" && p.stage === "lost") notes.push("A lost deal can be reopened later by moving it back to Meeting.");
  return notes;
}

export function salesRows(kind: string, p: Rec): CardRow[] {
  const rows: CardRow[] = [];
  const add = (l: string, value: string) => value && rows.push({ label: l, value });
  switch (kind) {
    case "log_activity":
      add("Institution", clip(text(p.institution_name), 120));
      add("What", label(ACTIVITY_LABELS, p.kind));
      add("Outcome", text(p.outcome) ? label(OUTCOME_LABELS, p.outcome) : "");
      add("When", text(p.happened_on) ? day(text(p.happened_on)) : "Today");
      add("Notes", clip(text(p.notes), 300));
      add("Next step", clip(text(p.next_step), 200));
      add("Due", text(p.next_step_due) ? day(text(p.next_step_due)) : "");
      break;
    case "create_deal":
      add("Institution", clip(text(p.institution_name), 120));
      add("Type", label(DEAL_KIND_LABELS, p.kind));
      add("Title", clip(text(p.title) || defaultDealTitle(p.kind as DealKind, text(p.institution_name)), 200));
      add("Value", rupees(p.value_inr));
      add("Win chance", text(p.probability) ? `${text(p.probability)}%` : "");
      add("Expected close", text(p.expected_close) ? day(text(p.expected_close)) : "");
      break;
    case "update_deal":
      add("Deal", clip(text(p.deal_title), 200));
      for (const [k, v] of Object.entries(asRecord(p.changes))) add(CHANGE_LABEL[k] ?? k, changeValue(k, v));
      break;
    case "move_deal":
      add("Deal", clip(text(p.deal_title), 200));
      add("From", label(DEAL_STAGE_LABELS, p.from));
      add("To", label(DEAL_STAGE_LABELS, p.stage));
      add("Reason", clip(text(p.lost_reason), 300));
      add("Win chance", text(p.probability) ? `${text(p.probability)}%` : "");
      break;
  }
  return rows;
}
