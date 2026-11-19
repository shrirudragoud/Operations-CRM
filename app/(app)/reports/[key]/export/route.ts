import { getMe } from "@/lib/auth";
import { csvResponse } from "@/lib/csv/export";
import { todayIST } from "@/lib/format";
import { runReport } from "@/lib/queries/reports";
import { REPORTS, canRunReport, isReportKey, parseRange, reportFilename, tableToCsv } from "@/lib/reports";
import { createClient } from "@/utils/supabase/server";

/** One report as a spreadsheet, read as the signed-in person: row-level security limits the rows, never a service key. */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isReportKey(key)) return new Response("No such report.", { status: 404 });
  const me = await getMe();
  if (!me) return new Response("Sign in again.", { status: 401 });
  if (!canRunReport(me, key)) return new Response("You do not have access to this report.", { status: 403 });

  const today = todayIST();
  const sp = new URL(request.url).searchParams;
  const range = parseRange({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined }, today, REPORTS[key].maxDays);
  const result = await runReport(await createClient(), me, key, range, today);
  if (!result.ok) return new Response(result.error, { status: 500 });
  return csvResponse(tableToCsv(result.table), reportFilename(key, result.table.range));
}
