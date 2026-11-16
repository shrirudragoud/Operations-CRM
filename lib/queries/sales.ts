import "server-only";
import type { Me } from "@/lib/permissions";
import type { SalesParams } from "@/lib/schemas/deal";
import { createClient } from "@/utils/supabase/server";

// Read queries for the Sales workspace. Explicit columns and bounded result sets. RLS decides what
// each role sees (Sales: all deals; partner: their own), so "mine"/"all" is a convenience filter only.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const OPEN = ["meeting", "proposal", "negotiation"];
const BOARD_OPEN_LIMIT = 300;
const BOARD_CLOSED_LIMIT = 20;

const CARD =
  "id, title, kind, stage, value_inr, probability, expected_close, owner_id, updated_at, won_at, institution:institution!inner(id, name, city, segment), owner:staff!deal_owner_id_fkey(full_name)";

function filtered<T extends { eq: (c: string, v: string) => T }>(q: T, me: Me, p: SalesParams): T {
  let out = q;
  if (p.kind) out = out.eq("kind", p.kind);
  if (p.segment) out = out.eq("institution.segment", p.segment);
  if (p.scope === "mine") out = out.eq("owner_id", me.id);
  return out;
}

/** Open deals (soonest expected close first) and the latest Won and Lost, for the kanban board. */
export async function listBoard(supabase: Supabase, me: Me, p: SalesParams) {
  const [open, won, lost] = await Promise.all([
    filtered(supabase.from("deal").select(CARD, { count: "exact" }).is("archived_at", null).in("stage", OPEN), me, p)
      .order("expected_close", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(BOARD_OPEN_LIMIT),
    filtered(supabase.from("deal").select(CARD, { count: "exact" }).is("archived_at", null).eq("stage", "won"), me, p)
      .order("won_at", { ascending: false, nullsFirst: false })
      .limit(BOARD_CLOSED_LIMIT),
    filtered(supabase.from("deal").select(CARD, { count: "exact" }).is("archived_at", null).eq("stage", "lost"), me, p)
      .order("updated_at", { ascending: false })
      .limit(BOARD_CLOSED_LIMIT),
  ]);
  return { open, won, lost, openLimit: BOARD_OPEN_LIMIT, closedLimit: BOARD_CLOSED_LIMIT };
}

export type BoardDeal = NonNullable<Awaited<ReturnType<typeof listBoard>>["open"]["data"]>[number];

/** Everything the deal detail page needs in one round trip. Null data = not found or not visible. */
export async function getDeal(supabase: Supabase, id: string) {
  return supabase
    .from("deal")
    .select(
      `id, title, kind, stage, value_inr, probability, expected_close, owner_id, lost_reason, won_at, archived_at, created_at, updated_at,
       institution:institution!inner(id, name, kind, segment, city, district, stage, owner_id, archived_at),
       owner:staff!deal_owner_id_fkey(full_name),
       archiver:staff!deal_archived_by_fkey(full_name),
       lines:deal_line(id, description, qty, unit_price_inr, seq),
       events:event!event_deal_id_fkey(id, title, status, starts_at)`,
    )
    .eq("id", id)
    .order("seq", { referencedTable: "lines", ascending: true })
    .maybeSingle();
}

export type DealDetail = NonNullable<Awaited<ReturnType<typeof getDeal>>["data"]>;

/** Deal-type x segment x stage counts and values (security_invoker view, so RLS applies). */
export async function pipelineRows(supabase: Supabase) {
  return supabase.from("v_pipeline").select("kind, segment, stage, deals, value_inr, weighted_inr");
}

export async function funnelRows(supabase: Supabase) {
  return supabase.from("v_funnel").select("segment, stage, institutions");
}

const FORECAST_LIMIT = 2000;

/** Open deals for the month-by-month forecast. */
export async function openDealsForForecast(supabase: Supabase) {
  return supabase
    .from("deal")
    .select("expected_close, value_inr, probability")
    .is("archived_at", null)
    .in("stage", OPEN)
    .limit(FORECAST_LIMIT);
}

const SCORECARD_LIMIT = 5000;

/** Deals and institutions owned by partners, for the scorecard. */
export async function partnerData(supabase: Supabase) {
  const [partners, deals, institutions] = await Promise.all([
    supabase.from("staff").select("id, full_name, email, is_active").eq("role", "partner").order("full_name"),
    supabase
      .from("deal")
      .select("owner_id, stage, value_inr, owner:staff!deal_owner_id_fkey!inner(role)")
      .eq("owner.role", "partner")
      .is("archived_at", null)
      .limit(SCORECARD_LIMIT),
    supabase
      .from("institution")
      .select("owner_id, owner:staff!institution_owner_id_fkey!inner(role)")
      .eq("owner.role", "partner")
      .is("archived_at", null)
      .limit(SCORECARD_LIMIT),
  ]);
  return { partners, deals, institutions };
}
