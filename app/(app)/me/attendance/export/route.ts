import { getMe } from "@/lib/auth";
import { istMinutes, monthToCsv, parseMonth } from "@/lib/attendance";
import { todayIST } from "@/lib/format";
import { canCheckIn } from "@/lib/permissions";
import { getMonth, getOfficeSettings } from "@/lib/queries/attendance";
import { createClient } from "@/utils/supabase/server";

/** My own month as a spreadsheet. RLS already limits attendance_month to people who may see this person's record. */
export async function GET(request: Request) {
  const me = await getMe();
  if (!me) return new Response("Sign in again.", { status: 401 });
  if (!canCheckIn(me)) return new Response("Attendance is not switched on for you.", { status: 403 });

  const month = parseMonth(new URL(request.url).searchParams.get("month") ?? undefined, todayIST());
  const supabase = await createClient();
  const [settings, days] = await Promise.all([getOfficeSettings(supabase), getMonth(supabase, me.id, month)]);
  if (!settings.data || days.error) return new Response("Could not load attendance.", { status: 500 });

  const csv = monthToCsv(days.data, settings.data, todayIST(), istMinutes(new Date()));
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="attendance-${month}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
