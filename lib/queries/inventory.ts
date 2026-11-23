import "server-only";
import { createClient } from "@/utils/supabase/server";

// Read queries over the stock views. Stock is a ledger: counts come from the views, never from editing a row.
// The views are security_invoker, so RLS decides what a person sees.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const STOCK_LIMIT = 200;

export type StockRow = { sku: string; name: string; reorder_level: number; on_hand: number; in_warehouse: number; reserved: number; available: number };

const toRow = (r: { sku: string | null; name: string | null; reorder_level: number | null; on_hand: number | null; in_warehouse: number | null; reserved: number | null; available: number | null }): StockRow => ({
  sku: r.sku ?? "",
  name: r.name ?? "",
  reorder_level: r.reorder_level ?? 0,
  on_hand: r.on_hand ?? 0,
  in_warehouse: r.in_warehouse ?? 0,
  reserved: r.reserved ?? 0,
  available: r.available ?? 0,
});

/** Items with their counts. `q` is already cleaned of characters that break a filter. */
export async function listStock(supabase: Supabase, q: string): Promise<{ rows: StockRow[]; total: number }> {
  let query = supabase.from("v_stock").select("sku, name, reorder_level, on_hand, in_warehouse, reserved, available", { count: "exact" });
  if (q) query = query.or(`name.ilike.*${q}*,sku.ilike.*${q}*`);
  const { data, count } = await query.order("name").limit(STOCK_LIMIT);
  const rows = (data ?? []).map(toRow);
  return { rows, total: count ?? rows.length };
}

/** Items at or below their reorder level, the lowest first. */
export async function listLowStock(supabase: Supabase): Promise<StockRow[]> {
  const { data } = await supabase
    .from("v_low_stock")
    .select("sku, name, reorder_level, on_hand, in_warehouse, reserved, available")
    .order("available", { ascending: true })
    .limit(STOCK_LIMIT);
  return (data ?? []).map(toRow);
}

export type Reservation = { sku: string; name: string; qty: number; status: string };

export async function listReservations(supabase: Supabase, eventId: string): Promise<Reservation[]> {
  const { data } = await supabase.from("stock_reservation").select("qty, status, item:item(sku, name)").eq("event_id", eventId).limit(100);
  return (data ?? []).map((r) => ({ sku: r.item?.sku ?? "", name: r.item?.name ?? "Item", qty: r.qty, status: r.status }));
}
