"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { importResultSchema, importRowsSchema, type ImportResult } from "@/lib/csv/institutions";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import {
  canArchiveInstitution, canCorrectStage, canCreateInstitution, canEditInstitution, canImportInstitutions,
  canManageContacts, type Me,
} from "@/lib/permissions";
import {
  correctStageSchema, createContactSchema, deleteContactSchema, institutionIdSchema, institutionSchema,
  updateContactSchema, updateInstitutionSchema,
} from "@/lib/schemas/institution";
import { createClient } from "@/utils/supabase/server";

// Thin wrappers over the institution and contact tables (RLS + triggers are the real guard; see
// docs/BUSINESS_RULES.md). Each action re-checks the caller, validates with Zod and returns the
// database's own rule message on failure. The stage column is never written here except by
// correctStage, which is founder-only.

type Invalid = { ok: false; error: string; fieldErrors: Record<string, string[]> };

function invalid(error: z.ZodError): Invalid {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

const NOT_FOUND = "That record was not found, or you don't have permission to change it.";
const DUPLICATE_NAME = "That institution already exists";

async function caller(): Promise<{ me: Me } | { ok: false; error: string }> {
  const c = await actionCaller("institutions");
  return "error" in c ? { ok: false, error: c.error } : c;
}

function refresh(id?: string) {
  revalidatePath("/institutions");
  if (id) revalidatePath(`/institutions/${id}`);
}

export async function createInstitution(input: unknown): Promise<ActionResult<{ id: string }>> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canCreateInstitution(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = institutionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  // A partner may only create institutions they own (institution_ins).
  const owner_id = c.me.role === "partner" ? c.me.id : parsed.data.owner_id;
  const { data, error } = await supabase
    .from("institution")
    .insert({ ...parsed.data, owner_id })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: DUPLICATE_NAME, fieldErrors: { name: [DUPLICATE_NAME] } };
    }
    return fail(error, "createInstitution");
  }
  refresh();
  return { ok: true, data: { id: data.id } };
}

export async function updateInstitution(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = updateInstitutionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { id, owner_id, ...fields } = parsed.data;

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("institution").select("owner_id").eq("id", id).maybeSingle();
  if (readError) return fail(readError, "updateInstitution.read");
  if (!current) return { ok: false, error: NOT_FOUND };
  if (!canEditInstitution(c.me, current.owner_id)) return { ok: false, error: PERMISSION_ERROR };

  // Partners cannot hand their institution to someone else (the policy would reject it anyway).
  const patch = c.me.role === "partner" ? fields : { ...fields, owner_id };
  const { data, error } = await supabase.from("institution").update(patch).eq("id", id).select("id").maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: DUPLICATE_NAME, fieldErrors: { name: [DUPLICATE_NAME] } };
    }
    return fail(error, "updateInstitution");
  }
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(id);
  return { ok: true, data: undefined };
}

const notesSchema = z.object({ id: z.uuid(), notes: z.string().trim().max(4000, "Keep the notes under 4000 characters.") });

export async function updateInstitutionNotes(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = notesSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("institution").select("owner_id").eq("id", parsed.data.id).maybeSingle();
  if (readError) return fail(readError, "updateInstitutionNotes.read");
  if (!current) return { ok: false, error: NOT_FOUND };
  if (!canEditInstitution(c.me, current.owner_id)) return { ok: false, error: PERMISSION_ERROR };

  const { data, error } = await supabase
    .from("institution")
    .update({ notes: parsed.data.notes === "" ? null : parsed.data.notes })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, "updateInstitutionNotes");
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(parsed.data.id);
  return { ok: true, data: undefined };
}

async function setArchived(input: unknown, archive: boolean, context: string): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = institutionIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("institution").select("owner_id").eq("id", parsed.data.id).maybeSingle();
  if (readError) return fail(readError, `${context}.read`);
  if (!current) return { ok: false, error: NOT_FOUND };
  if (!canArchiveInstitution(c.me, current.owner_id)) {
    return { ok: false, error: "Only a founder or department lead can archive or restore records" };
  }

  // The guard_archive trigger stamps archived_by and raises the rule errors ("Close or archive the
  // institution's open deals first", ...), which fail() passes through unchanged.
  const { data, error } = await supabase
    .from("institution")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, context);
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(parsed.data.id);
  return { ok: true, data: undefined };
}

export async function archiveInstitution(input: unknown): Promise<ActionResult> {
  return setArchived(input, true, "archiveInstitution");
}

export async function restoreInstitution(input: unknown): Promise<ActionResult> {
  return setArchived(input, false, "restoreInstitution");
}

/** Founder-only correction of the lifecycle stage. Normal stage changes come from activities, deals and events. */
export async function correctInstitutionStage(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  // The trigger only blocks non-founders from moving backwards; forward jumps by anyone would pass,
  // so this check is what keeps the correction founder-only.
  if (!canCorrectStage(c.me)) return { ok: false, error: "Only the founder can correct an institution's stage" };
  const parsed = correctStageSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("institution")
    .update({ stage: parsed.data.stage })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, "correctInstitutionStage");
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(parsed.data.id);
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------- contacts

async function contactGuard(institutionId: string): Promise<{ me: Me } | { ok: false; error: string }> {
  const c = await caller();
  if ("ok" in c) return c;
  const supabase = await createClient();
  const { data, error } = await supabase.from("institution").select("owner_id").eq("id", institutionId).maybeSingle();
  if (error) return fail(error, "contactGuard");
  if (!data) return { ok: false, error: NOT_FOUND };
  if (!canManageContacts(c.me, data.owner_id)) return { ok: false, error: PERMISSION_ERROR };
  return c;
}

export async function createContact(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = createContactSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const g = await contactGuard(parsed.data.institution_id);
  if ("ok" in g) return g;

  const supabase = await createClient();
  const { data, error } = await supabase.from("contact").insert(parsed.data).select("id").single();
  if (error) return fail(error, "createContact");
  refresh(parsed.data.institution_id);
  return { ok: true, data: { id: data.id } };
}

export async function updateContact(input: unknown): Promise<ActionResult> {
  const parsed = updateContactSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const g = await contactGuard(parsed.data.institution_id);
  if ("ok" in g) return g;

  const { id, institution_id, ...fields } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact")
    .update(fields)
    .eq("id", id)
    .eq("institution_id", institution_id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, "updateContact");
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(institution_id);
  return { ok: true, data: undefined };
}

export async function deleteContact(input: unknown): Promise<ActionResult> {
  const parsed = deleteContactSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const g = await contactGuard(parsed.data.institution_id);
  if ("ok" in g) return g;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact")
    .delete()
    .eq("id", parsed.data.id)
    .eq("institution_id", parsed.data.institution_id)
    .select("id");
  if (error) return fail(error, "deleteContact");
  if (!data.length) return { ok: false, error: NOT_FOUND };
  refresh(parsed.data.institution_id);
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------- CSV import

const importInputSchema = z.object({ rows: importRowsSchema, dryRun: z.boolean() });

/** Dry run validates every row and writes nothing; the real run is all-or-nothing (ops.import_institutions). */
export async function importInstitutions(input: unknown): Promise<ActionResult<ImportResult>> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canImportInstitutions(c.me)) return { ok: false, error: "You do not have permission to import institutions" };
  const parsed = importInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "The file could not be read." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_institutions", {
    p_rows: parsed.data.rows,
    p_dry_run: parsed.data.dryRun,
  });
  if (error) return fail(error, "importInstitutions");
  const result = importResultSchema.safeParse(data);
  if (!result.success) return { ok: false, error: "The import returned an unexpected answer. Nothing was changed." };
  if (!parsed.data.dryRun && result.data.inserted > 0) refresh();
  return { ok: true, data: result.data };
}
