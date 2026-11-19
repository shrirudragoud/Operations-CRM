import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClockIcon, CalendarCheck2Icon, CircleAlertIcon, CircleCheckIcon, DownloadIcon, PrinterIcon, TimerIcon } from "lucide-react";
import { AttendanceToday } from "@/components/attendance-today";
import { Chip } from "@/components/chips";
import { MonthGrid } from "@/components/portal/month-grid";
import { MonthTable } from "@/components/portal/month-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMe } from "@/lib/auth";
import { describeDays, istMinutes, monthLabel, monthTotals, parseMonth } from "@/lib/attendance";
import { todayIST } from "@/lib/format";
import { canCheckIn } from "@/lib/permissions";
import { getMonth, getOfficeSettings } from "@/lib/queries/attendance";
import { formatHM } from "@/lib/schemas/time";
import { createClient } from "@/utils/supabase/server";
import { StatCard } from "../../my-day-widgets";

export const metadata: Metadata = { title: "My attendance" };

const LINK = "hover:bg-muted focus-visible:ring-ring/50 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium outline-none focus-visible:ring-[3px]";

export default async function MyAttendancePage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const me = await requireMe();
  if (!canCheckIn(me)) {
    return (
      <Card className="max-w-xl">
        <CardHeader><CardTitle className="text-base">Attendance</CardTitle></CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Attendance is not switched on for you yet. Once the founder turns it on, your month appears here.
        </CardContent>
      </Card>
    );
  }

  const today = todayIST();
  const month = parseMonth((await searchParams).month, today);
  const supabase = await createClient();
  const [settings, days] = await Promise.all([getOfficeSettings(supabase), getMonth(supabase, me.id, month)]);
  if (!settings.data || days.error) {
    return (
      <Card className="max-w-xl">
        <CardContent role="alert" className="text-sm">We could not load your attendance. Refresh the page, and tell the founder if it keeps happening.</CardContent>
      </Card>
    );
  }

  const now = istMinutes(new Date());
  const lines = describeDays(days.data, settings.data, today, now);
  const t = monthTotals(days.data, settings.data, today, now);
  const flags = settings.data.flags_on;
  const thisMonth = today.slice(0, 7);
  const q = `month=${month}`;

  return (
    <div className="space-y-6">
      <section aria-label="Today at work" className="max-w-xl">
        <AttendanceToday me={me} />
      </section>

      <section aria-label="Month summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={CalendarCheck2Icon} tone="slate" label="Working days so far" value={t.workingDays} hint={t.holidays > 0 ? `${t.holidays} holiday${t.holidays === 1 ? "" : "s"} this month` : undefined} />
        <StatCard icon={CircleCheckIcon} tone="green" label="Days present" value={t.present} hint={t.remoteDays > 0 ? `${t.remoteDays} from outside the office` : undefined} />
        {flags && <StatCard icon={AlarmClockIcon} tone={t.late > 0 ? "amber" : "slate"} label="Late arrivals" value={t.late} />}
        {flags && <StatCard icon={CircleAlertIcon} tone={t.absent > 0 ? "red" : "slate"} label="Absent days" value={t.absent} />}
        <StatCard icon={TimerIcon} tone="blue" label="Hours worked" value={formatHM(t.minutes)} hint={t.present > 0 ? `${formatHM(t.averageMinutes)} a day on average` : undefined} />
      </section>
      {!flags && (
        <p className="text-muted-foreground text-sm">Late and absent days are not counted yet. They start once the founder switches the flags on.</p>
      )}
      {t.missing > 0 && (
        <p role="status" className="text-sm">
          <Chip tone="orange" icon={CircleAlertIcon}>{t.missing} day{t.missing === 1 ? "" : "s"} with no check-out</Chip>{" "}
          <span className="text-muted-foreground">Ask your lead to add the time.</span>
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{monthLabel(month)}</CardTitle>
          <nav aria-label="Month actions" className="flex flex-wrap gap-2">
            {month !== thisMonth && <Link className={LINK} href="/me/attendance">This month</Link>}
            <Link className={LINK} href={`/me/attendance/statement?${q}`}><PrinterIcon aria-hidden className="size-4" />Statement</Link>
            <a className={LINK} href={`/me/attendance/export?${q}`} download><DownloadIcon aria-hidden className="size-4" />CSV</a>
          </nav>
        </CardHeader>
        <CardContent className="space-y-6">
          <MonthGrid
            month={month}
            today={today}
            cells={lines.map((d) => ({ date: d.date, label: d.label, short: d.short, tone: d.tone, worked: d.worked }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Day by day</CardTitle></CardHeader>
        <CardContent>
          <MonthTable days={lines} caption={`Attendance for ${monthLabel(month)}`} />
        </CardContent>
      </Card>
    </div>
  );
}
