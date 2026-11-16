"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import {
  canArchiveDeal, canEditDeal, canManageDeals, canMarkDealWon, canMoveDeal, type Me,
} from "@/lib/permissions";
import {
  DEAL_KIND_LABELS, dealIdSchema, dealLinesSchema, dealSchema, defaultDealTitle, moveDealSchema, updateDealSchema,
  wonOutcome, type DealKind,
} from "@/lib/schemas/deal";
import { createClient } from "@/utils/supabase/server";

// Sales writes. Stage rules, "only the founder marks Won", the Won -> event/tasks hand-off and the
// one-open-deal-per-type rule all live in the database; these actions validate, pre-check the friendly
// cases and show the database's own message otherwise (docs/BUSINESS_RULES.md).

const NOT_FOUND = "That deal was not found, or you don't have permission to change it.";

function invalid(error: z.ZodError): { ok: false; error: string; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

async function caller(): Promise<{ me: Me } | { ok: false; error: string }> {
  const c = await actionCaller("sales");
  return "error" in c ? { ok: false, error: c.error } : c;
}

function refresh(id?: string, institutionId?: string) {
  revalidatePath("/sales");
  if (id) revalidatePath(`/sales/${id}`);
  if (institutionId) revalidatePath(`/institutions/${institutionId}`);
  revalidatePath("/institutions");
  revalidatePath("/");
}

const duplicateOpen = (kind: DealKind) => `This institution already has an open ${DEAL_KIND_LABELS[kind]} deal. Finish or close it first.`;

export async function createDeal(input: unknown): Promise<ActionResult<{ id: string }>> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canManageDeals(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = dealSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  // RLS hides institutions a partner does not own, so this also stops a partner opening deals elsewhere.
  const { data: inst, error: instError } = await supabase
    .from("institution")
    .select("id, name, archived_at")
    .eq("id", v.institution_id)
    .maybeSingle();
  if (instError) return fail(instError, "createDeal.institution");
  if (!inst) return { ok: false, error: "That institution was not found, or you don't have access to it." };
  if (inst.archived_at) return { ok: false, error: "This institution is archived. Restore it before opening a deal." };

  const { data: open, error: openError } = await supabase
    .from("deal")
    .select("id")
    .eq("institution_id", v.institution_id)
    .eq("kind", v.kind)
    .is("archived_at", null)
    .in("stage", ["meeting", "proposal", "negotiation"])
    .limit(1);
  if (openError) return fail(openError, "createDeal.open");
  if (open.length > 0) return { ok: false, error: duplicateOpen(v.kind), fieldErrors: { kind: [duplicateOpen(v.kind)] } };

  const { data, error } = await supabase
    .from("deal")
    .insert({
      institution_id: v.institution_id,
      kind: v.kind,
      title: v.title || defaultDealTitle(v.kind, inst.name),
      value_inr: v.value_inr,
      probability: v.probability,
      expected_close: v.expected_close,
      owner_id: c.me.role === "partner" ? c.me.id : (v.owner_id ?? c.me.id),
    })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? { ok: false, error: duplicateOpen(v.kind) } : fail(error, "createDeal");
  refresh(data.id, v.institution_id);
  return { ok: true, data: { id: data.id } };
}

async function loadDeal(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  return supabase.from("deal").select("id, kind, stage, owner_id, institution_id").eq("id", id).maybeSingle();
}

export async function updateDeal(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = updateDealSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: deal, error: readError } = await loadDeal(supabase, v.id);
  if (readError) return fail(readError, "updateDeal.read");
  if (!deal) return { ok: false, error: NOT_FOUND };
  if (!canEditDeal(c.me, deal)) {
    return { ok: false, error: deal.stage === "won" ? "Only the founder can change a won deal" : deal.stage === "lost" ? "Reopen the deal before editing it." : PERMISSION_ERROR };
  }

  const { data, error } = await supabase
    .from("deal")
    .update({
      title: v.title,
      value_inr: v.value_inr,
      probability: v.probability,
      expected_close: v.expected_close,
      ...(c.me.role === "partner" || !v.owner_id ? {} : { owner_id: v.owner_id }),
    })
    .eq("id", v.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, "updateDeal");
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(v.id, deal.institution_id);
  return { ok: true, data: undefined };
}

export type MovedDeal = { stage: string; created: string[] };

/** Move a deal along the pipeline. Won is founder-only; Lost needs a reason; both enforced by ops.deal_transition. */
export async function moveDeal(input: unknown): Promise<ActionResult<MovedDeal>> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = moveDealSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: deal, error: readError } = await loadDeal(supabase, v.id);
  if (readError) return fail(readError, "moveDeal.read");
  if (!deal) return { ok: false, error: NOT_FOUND };
  if (!canMoveDeal(c.me, deal)) return { ok: false, error: deal.stage === "won" ? "A won deal cannot change stage" : PERMISSION_ERROR };
  if (v.stage === "won" && !canMarkDealWon(c.me)) return { ok: false, error: "Only the founder can mark a deal as won" };

  const probability = v.stage === "won" ? 100 : v.stage === "lost" ? 0 : v.probability;
  const { data, error } = await supabase
    .from("deal")
    .update({
      stage: v.stage,
      lost_reason: v.stage === "lost" ? v.lost_reason : null,
      ...(probability === null ? {} : { probability }),
    })
    .eq("id", v.id)
    .select("id")
    .maybeSingle();
  if (error) return error.code === "23505" ? { ok: false, error: duplicateOpen(deal.kind as DealKind) } : fail(error, "moveDeal");
  if (!data) return { ok: false, error: NOT_FOUND };

  refresh(v.id, deal.institution_id);
  if (v.stage === "won") {
    for (const path of ["/workshop", "/tasks", "/training"]) revalidatePath(path);
  }
  return { ok: true, data: { stage: v.stage, created: v.stage === "won" ? wonOutcome(deal.kind as DealKind) : [] } };
}

export async function saveDealLines(input: unknown): Promise<ActionResult<{ count: number; total: number }>> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = dealLinesSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: deal, error: readError } = await loadDeal(supabase, v.deal_id);
  if (readError) return fail(readError, "saveDealLines.read");
  if (!deal) return { ok: false, error: NOT_FOUND };
  if (!canEditDeal(c.me, deal)) return { ok: false, error: deal.stage === "won" ? "Only the founder can change a won deal" : deal.stage === "lost" ? "Reopen the deal before editing it." : PERMISSION_ERROR };

  const { data, error } = await supabase.rpc("replace_deal_lines", { p_deal: v.deal_id, p_lines: v.lines });
  if (error) return fail(error, "saveDealLines");
  refresh(v.deal_id);
  return { ok: true, data: { count: data, total: v.lines.reduce((s, l) => s + l.qty * l.unit_price_inr, 0) } };
}

async function setArchived(input: unknown, archive: boolean, context: string): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = dealIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  if (!canArchiveDeal(c.me)) return { ok: false, error: "Only a founder or department lead can archive or restore records" };

  const supabase = await createClient();
  const { data: deal, error: readError } = await loadDeal(supabase, parsed.data.id);
  if (readError) return fail(readError, `${context}.read`);
  if (!deal) return { ok: false, error: NOT_FOUND };

  // guard_archive stamps archived_by and refuses to archive a deal that is still open.
  const { data, error } = await supabase
    .from("deal")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) return error.code === "23505" ? { ok: false, error: duplicateOpen(deal.kind as DealKind) } : fail(error, context);
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(parsed.data.id, deal.institution_id);
  return { ok: true, data: undefined };
}

export async function archiveDeal(input: unknown): Promise<ActionResult> {
  return setArchived(input, true, "archiveDeal");
}

export async function restoreDeal(input: unknown): Promise<ActionResult> {
  return setArchived(input, false, "restoreDeal");
}
