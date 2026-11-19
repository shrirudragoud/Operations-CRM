import "server-only";
import { PAGE_SIZE, type ListParams } from "@/lib/schemas/institution";
import { createClient } from "@/utils/supabase/server";

// Read queries for the Institutions workspace. Explicit column lists (never select *), server-side
// pagination and a single embedded query for the 360 page (no N+1). RLS decides what each role sees.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function listInstitutions(supabase: Supabase, p: ListParams) {
  let query = supabase
    .from("institution")
    .select(
      "id, name, kind, city, district, state, stage, owner_id, archived_at, updated_at, owner:staff!institution_owner_id_fkey(full_name)",
      { count: "exact" },
    );

  if (p.archived === "hide") query = query.is("archived_at", null);
  if (p.archived === "only") query = query.not("archived_at", "is", null);
  if (p.stage) query = query.eq("stage", p.stage);
  if (p.kind) query = query.eq("kind", p.kind);
  if (p.district) query = query.ilike("district", `%${p.district}%`);
  if (p.owner === "none") query = query.is("owner_id", null);
  else if (p.owner) query = query.eq("owner_id", p.owner);
  // Trigram indexes (0013) make these substring searches fast. p.q is sanitised by parseListParams.
  if (p.q) query = query.or(`name.ilike.*${p.q}*,city.ilike.*${p.q}*`);

  const from = (p.page - 1) * PAGE_SIZE;
  return query
    .order(p.sort, { ascending: !p.desc, nullsFirst: false })
    .order("id")
    .range(from, from + PAGE_SIZE - 1);
}

export type InstitutionRow = NonNullable<Awaited<ReturnType<typeof listInstitutions>>["data"]>[number];

const MAX_OWNERS = 500;

/** Active staff for the owner filter and picker. A partner can only see themselves (RLS). */
export async function listOwners(supabase: Supabase) {
  return supabase
    .from("staff")
    .select("id, full_name, role, departments")
    .eq("is_active", true)
    .order("full_name")
    .range(0, MAX_OWNERS - 1);
}

const RECENT = 25;

/** Everything the 360 page needs in one round trip. Null data = not found or not visible to this user. */
export async function getInstitution360(supabase: Supabase, id: string) {
  return supabase
    .from("institution")
    .select(
      `id, name, kind, affiliation, city, district, state, stage, source, notes, owner_id, archived_at, created_at, updated_at,
       owner:staff!institution_owner_id_fkey(full_name),
       archiver:staff!institution_archived_by_fkey(full_name),
       contacts:contact(id, full_name, designation, influence, phone, email, created_at),
       activities:activity(id, kind, outcome, notes, happened_at, next_step, next_step_due, author:staff!activity_staff_id_fkey(full_name)),
       deals:deal(id, title, kind, stage, value_inr, expected_close, archived_at),
       events:event(id, title, kind, status, starts_at, ends_at, archived_at)`,
    )
    .eq("id", id)
    .order("created_at", { referencedTable: "contacts", ascending: true })
    .order("happened_at", { referencedTable: "activities", ascending: false })
    .limit(RECENT, { referencedTable: "activities" })
    .order("expected_close", { referencedTable: "deals", ascending: false, nullsFirst: false })
    .limit(RECENT, { referencedTable: "deals" })
    .order("starts_at", { referencedTable: "events", ascending: false, nullsFirst: false })
    .limit(RECENT, { referencedTable: "events" })
    .maybeSingle();
}

export type Institution360 = NonNullable<Awaited<ReturnType<typeof getInstitution360>>["data"]>;
