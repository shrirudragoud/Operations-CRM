import type { Metadata } from "next";
import Link from "next/link";
import { MonthTable } from "@/components/portal/month-table";
import { PrintButton } from "@/components/portal/print-button";
import { requireMe } from "@/lib/auth";
import { describeDays, istMinutes, monthLabel, monthTotals, parseMonth } from "@/lib/attendance";
import { formatDate, todayIST } from "@/lib/format";
import { canCheckIn } from "@/lib/permissions";
import { getMonth, getOfficeSettings } from "@/lib/queries/attendance";
import { formatHM } from "@/lib/schemas/time";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "Attendance statement" };

// Print only the statement: the app's own chrome (sidebar, header, tabs) is hidden on paper.
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #statement, #statement * { visibility: visible !important; }
  #statement { position: absolute; inset: 0; padding: 0; }
}`;

export default async function AttendanceStatementPage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const me = await requireMe();
  if (!canCheckIn(me)) return <p className="text-muted-foreground text-sm">Attendance is not switched on for you.</p>;

  const today = todayIST();
  const month = parseMonth((await searchParams).month, today);
  const supabase = await createClient();
  const [settings, days] = await Promise.all([getOfficeSettings(supabase), getMonth(supabase, me.id, month)]);
  if (!settings.data || days.error) return <p role="alert" className="text-sm">We could not load your attendance. Refresh the page.</p>;

  const now = istMinutes(new Date());
  const lines = describeDays(days.data, settings.data, today, now);
  const t = monthTotals(days.data, settings.data, today, now);
  const flags = settings.data.flags_on;

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap gap-2 print:hidden">
        <PrintButton />
        <Link href={`/me/attendance?month=${month}`} className="hover:bg-muted inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium">Back to my month</Link>
      </div>
      <article id="statement" aria-label={`Attendance statement, ${monthLabel(month)}`} className="bg-card max-w-3xl space-y-4 rounded-lg border p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">Attendance statement, {monthLabel(month)}</h2>
          <p className="text-sm">{me.full_name} <span className="text-muted-foreground">({me.email})</span></p>
          <p className="text-muted-foreground text-xs">Hard-Code. Prepared on {formatDate(today)}.</p>
        </header>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground inline">Working days so far: </dt><dd className="inline font-medium">{t.workingDays}</dd></div>
          <div><dt className="text-muted-foreground inline">Days present: </dt><dd className="inline font-medium">{t.present}</dd></div>
          <div><dt className="text-muted-foreground inline">Hours worked: </dt><dd className="inline font-medium">{formatHM(t.minutes)}</dd></div>
          <div><dt className="text-muted-foreground inline">Holidays: </dt><dd className="inline font-medium">{t.holidays}</dd></div>
          {flags && <div><dt className="text-muted-foreground inline">Late arrivals: </dt><dd className="inline font-medium">{t.late}</dd></div>}
          {flags && <div><dt className="text-muted-foreground inline">Absent days: </dt><dd className="inline font-medium">{t.absent}</dd></div>}
        </dl>
        <MonthTable days={lines} caption={`Attendance for ${monthLabel(month)}`} />
      </article>
    </div>
  );
}
