import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, CircleAlertIcon } from "lucide-react";
import { LoadError } from "@/components/load-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, todayIST } from "@/lib/format";
import type { Me } from "@/lib/permissions";
import { listCalendar, listNeedsScheduling, type CalendarRow } from "@/lib/queries/workshop";
import {
  EVENT_KIND_LABELS, EVENT_STATUS_LABELS, currentMonth, dayOfEvent, eventsByDay, monthGrid, shiftMonth,
  type EventKind, type EventStatus, type WorkshopParams,
} from "@/lib/schemas/event";
import { createClient } from "@/utils/supabase/server";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PER_DAY = 3;

const CHIP: Record<EventStatus, string> = {
  draft: "border-dashed bg-background",
  scheduled: "bg-primary/10 border-primary/40",
  in_progress: "bg-primary text-primary-foreground border-primary",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

function Chip({ ev, day }: { ev: CalendarRow; day: string }) {
  const status = ev.status as EventStatus;
  const part = ev.starts_at && ev.ends_at ? dayOfEvent(ev.starts_at, ev.ends_at, day) : null;
  const label = `${ev.institution.name}${part ? `, ${part}` : ""}. ${EVENT_KIND_LABELS[ev.kind as EventKind] ?? ev.kind}, ${EVENT_STATUS_LABELS[status] ?? ev.status}${ev.lead ? `, trainer ${ev.lead.full_name}` : ""}`;
  return (
    <Link
      href={`/workshop/${ev.id}`}
      aria-label={label}
      title={label}
      className={`block truncate rounded border px-1.5 py-0.5 text-xs hover:underline ${CHIP[status] ?? ""}`}
    >
      {ev.institution.name}
      {part ? ` (${part.replace("Day ", "D").replace(" of ", "/")})` : ""}
    </Link>
  );
}

export async function CalendarView({
  me, params, link,
}: { me: Me; params: WorkshopParams; link: (p: Partial<WorkshopParams>) => string }) {
  const supabase = await createClient();
  const [cal, drafts] = await Promise.all([listCalendar(supabase, me, params), listNeedsScheduling(supabase, me, params)]);
  if (cal.error || drafts.error) return <LoadError what="the calendar" />;

  const today = todayIST();
  const byDay = eventsByDay(cal.data);
  const grid = monthGrid(params.month);
  const truncated = (cal.count ?? cal.data.length) > cal.data.length;

  return (
    <div className="space-y-4">
      {drafts.data.length > 0 && (
        <Alert>
          <CircleAlertIcon aria-hidden />
          <AlertTitle>Needs scheduling ({drafts.count ?? drafts.data.length})</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {drafts.data.slice(0, 8).map((d) => (
                <li key={d.id}>
                  <Link href={`/workshop/${d.id}`} className="underline">{d.institution.name}</Link>
                  <span className="text-muted-foreground"> · {EVENT_KIND_LABELS[d.kind as EventKind] ?? d.kind}</span>
                </li>
              ))}
              {(drafts.count ?? 0) > 8 && (
                <li><Link href={link({ tab: "events", status: "draft" })} className="underline">See all {drafts.count}</Link></li>
              )}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold" aria-live="polite">{monthLabel(params.month)}</h2>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={link({ month: shiftMonth(params.month, -1) })} aria-label="Previous month"><ChevronLeftIcon aria-hidden /> Prev</Link>
          </Button>
          <Button asChild variant="outline" size="sm"><Link href={link({ month: currentMonth() })}>Today</Link></Button>
          <Button asChild variant="outline" size="sm">
            <Link href={link({ month: shiftMonth(params.month, 1) })} aria-label="Next month">Next <ChevronRightIcon aria-hidden /></Link>
          </Button>
        </div>
      </div>

      {truncated && (
        <p className="text-muted-foreground text-sm" role="status">
          Showing the first {cal.data.length} events this month. Filter by type or trainer to narrow it down.
        </p>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[44rem] overflow-hidden rounded-lg border" role="grid" aria-label={`Events in ${monthLabel(params.month)}`}>
          <div className="bg-muted/50 grid grid-cols-7 border-b text-xs font-medium" role="row">
            {WEEKDAYS.map((d) => <div key={d} role="columnheader" className="px-2 py-1.5">{d}</div>)}
          </div>
          {grid.map((week) => (
            <div key={week[0]} className="grid grid-cols-7 border-b last:border-b-0" role="row">
              {week.map((day) => {
                const inMonth = day.startsWith(params.month);
                const events = byDay.get(day) ?? [];
                const shown = events.slice(0, MAX_PER_DAY);
                const hidden = events.length - shown.length;
                return (
                  <div
                    key={day}
                    role="gridcell"
                    aria-label={formatDate(day)}
                    className={`min-h-24 space-y-1 border-r p-1.5 last:border-r-0 ${inMonth ? "" : "bg-muted/30 text-muted-foreground"}`}
                  >
                    <div className={`text-xs ${day === today ? "bg-primary text-primary-foreground inline-flex size-5 items-center justify-center rounded-full font-semibold" : ""}`}>
                      {Number(day.slice(8))}
                    </div>
                    {shown.map((ev) => <Chip key={ev.id} ev={ev} day={day} />)}
                    {hidden > 0 && (
                      <Link href={link({ tab: "events" })} className="text-muted-foreground block text-xs underline">+{hidden} more</Link>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <Card className="py-3">
        <CardHeader className="px-4 pb-0"><CardTitle className="text-sm">Key</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 px-4">
          {(Object.keys(CHIP) as EventStatus[]).map((s) => (
            <Badge key={s} variant="outline" className={CHIP[s]}>{EVENT_STATUS_LABELS[s]}</Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
