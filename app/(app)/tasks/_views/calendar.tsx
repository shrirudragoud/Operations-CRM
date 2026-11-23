import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDate, todayIST } from "@/lib/format";
import type { TaskRowRolled } from "@/lib/queries/tasks";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/schemas/activity";
import { formatSpan, type TaskParams } from "@/lib/schemas/task";
import { clusterCopies } from "@/lib/task-groups";
import { calendarMonth, mondayOf, monthWeeks, shiftMonth, tasksByDay } from "@/lib/task-layout";
import { chipClass, healthNote } from "./chip";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PER_DAY = 3;

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

function Chip({ t, people }: { t: TaskRowRolled; people: number }) {
  const who = people > 1 ? `given to ${people} people` : (t.assignee?.full_name ?? "unassigned");
  const label = `${t.title}. ${TASK_STATUS_LABELS[t.status as TaskStatus] ?? t.status}, ${who}, ${formatSpan(t.start_date, t.due_date, t.due_time)}.${healthNote(t)}`;
  return (
    <Link href={`/tasks/${t.id}`} aria-label={label} title={label} className={`block truncate rounded border px-1.5 py-0.5 text-xs hover:underline ${chipClass(t)}`}>
      {t.title}{people > 1 ? ` · ${people} people` : ""}
    </Link>
  );
}

export function TaskCalendar({ tasks: all, params, link }: { tasks: TaskRowRolled[]; params: TaskParams; link: (p: Partial<TaskParams>) => string }) {
  const today = todayIST();
  const month = calendarMonth(params.at, today);
  const weeks = monthWeeks(month);
  // Copies of one task given to several people share their dates: one chip, not one per person.
  const clusters = clusterCopies(all);
  const sizes = new Map(clusters.map((c) => [c.lead.id, c.copies.length]));
  const tasks = clusters.map((c) => c.lead);
  const byDay = tasksByDay(tasks, weeks.flat());
  const undated = tasks.filter((t) => !t.start_date && !t.due_date);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold" aria-live="polite">{monthLabel(month)}</h2>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={link({ at: shiftMonth(month, -1) })} aria-label="Previous month"><ChevronLeftIcon aria-hidden /> Prev</Link>
          </Button>
          <Button asChild variant="outline" size="sm"><Link href={link({ at: "" })}>Today</Link></Button>
          <Button asChild variant="outline" size="sm">
            <Link href={link({ at: shiftMonth(month, 1) })} aria-label="Next month">Next <ChevronRightIcon aria-hidden /></Link>
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[44rem] overflow-hidden rounded-lg border" role="grid" aria-label={`Tasks in ${monthLabel(month)}`}>
          <div className="bg-muted/50 grid grid-cols-7 border-b text-xs font-medium" role="row">
            {WEEKDAYS.map((d) => <div key={d} role="columnheader" className="px-2 py-1.5">{d}</div>)}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} className="grid grid-cols-7 border-b last:border-b-0" role="row">
              {week.map((day) => {
                const inMonth = day.startsWith(month);
                const items = byDay.get(day) ?? [];
                const shown = items.slice(0, MAX_PER_DAY);
                const hidden = items.length - shown.length;
                return (
                  <div key={day} role="gridcell" aria-label={formatDate(day)} className={`min-h-24 space-y-1 border-r p-1.5 last:border-r-0 ${inMonth ? "" : "bg-muted/30 text-muted-foreground"}`}>
                    <div className={`text-xs ${day === today ? "bg-primary text-primary-foreground inline-flex size-5 items-center justify-center rounded-full font-semibold" : ""}`}>
                      {Number(day.slice(8))}
                    </div>
                    {shown.map((t) => <Chip key={t.id} t={t} people={sizes.get(t.id) ?? 1} />)}
                    {hidden > 0 && (
                      <Link href={link({ layout: "timeline", at: mondayOf(day) })} className="text-muted-foreground block text-xs underline">
                        +{hidden} more (see the timeline)
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {undated.length > 0 && (
        <Alert>
          <CircleAlertIcon aria-hidden />
          <AlertTitle>{undated.length} {undated.length === 1 ? "task has" : "tasks have"} no dates</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {undated.slice(0, 8).map((t) => (
                <li key={t.id}><Link href={`/tasks/${t.id}`} className="underline">{t.title}</Link></li>
              ))}
              {undated.length > 8 && <li><Link href={link({ layout: "list" })} className="underline">See all in the table</Link></li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
