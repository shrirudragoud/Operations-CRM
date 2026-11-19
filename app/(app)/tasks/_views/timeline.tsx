import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { todayIST } from "@/lib/format";
import type { TaskRow } from "@/lib/queries/tasks";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/schemas/activity";
import { formatSpan, type TaskParams } from "@/lib/schemas/task";
import { addDays, barColumns, groupByPerson, timelineDays, timelineStart, TIMELINE_DAYS } from "@/lib/task-layout";
import { chipClass, healthNote } from "./chip";

const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });
const weekdayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short" });
const at = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

const GRID = { gridTemplateColumns: `repeat(${TIMELINE_DAYS}, minmax(2.5rem, 1fr))` } as const;

export function TaskTimeline({ tasks, params, link }: { tasks: TaskRow[]; params: TaskParams; link: (p: Partial<TaskParams>) => string }) {
  const today = todayIST();
  const start = timelineStart(params.at, today);
  const days = timelineDays(start);
  const end = days[days.length - 1] ?? start;
  const groups = groupByPerson(tasks);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold" aria-live="polite">{dayFmt.format(at(start))} to {dayFmt.format(at(end))}</h2>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={link({ at: addDays(start, -7) })} aria-label="Previous week"><ChevronLeftIcon aria-hidden /> Prev</Link>
          </Button>
          <Button asChild variant="outline" size="sm"><Link href={link({ at: "" })}>This week</Link></Button>
          <Button asChild variant="outline" size="sm">
            <Link href={link({ at: addDays(start, 7) })} aria-label="Next week">Next <ChevronRightIcon aria-hidden /></Link>
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">No tasks fall in these two weeks.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[56rem] overflow-hidden rounded-lg border" role="table" aria-label="Timeline of tasks by person">
            <div className="bg-muted/50 flex border-b text-xs font-medium" role="row">
              <div role="columnheader" className="w-40 shrink-0 px-2 py-1.5">Person</div>
              <div className="grid flex-1" style={GRID}>
                {days.map((d) => (
                  <div key={d} role="columnheader" className={`border-l px-1 py-1.5 text-center ${d === today ? "bg-primary text-primary-foreground" : ""}`}>
                    <div>{weekdayFmt.format(at(d))}</div>
                    <div className="font-normal">{Number(d.slice(8))}</div>
                  </div>
                ))}
              </div>
            </div>
            {groups.map(({ person, tasks: items }) => {
              const dated = items.filter((t) => barColumns(t, start));
              const undated = items.filter((t) => !t.start_date && !t.due_date);
              return (
                <div key={person.id ?? "none"} className="flex border-b last:border-b-0" role="row">
                  <div role="rowheader" className="w-40 shrink-0 px-2 py-2 text-sm font-medium">
                    {person.name}
                    <div className="text-muted-foreground text-xs font-normal">{items.length} {items.length === 1 ? "task" : "tasks"}</div>
                  </div>
                  <div className="flex-1 py-1" role="cell">
                    <div className="grid gap-y-1" style={GRID}>
                      {dated.map((t) => {
                        const cols = barColumns(t, start);
                        if (!cols) return null;
                        const label = `${t.title}. ${TASK_STATUS_LABELS[t.status as TaskStatus] ?? t.status}, ${person.name}, ${formatSpan(t.start_date, t.due_date, t.due_time)}.${healthNote(t)}`;
                        return (
                          <Link
                            key={t.id}
                            href={`/tasks/${t.id}`}
                            aria-label={label}
                            title={label}
                            style={{ gridColumn: `${cols.col} / ${cols.end}` }}
                            className={`mx-0.5 truncate border px-1.5 py-0.5 text-xs hover:underline ${cols.clippedStart ? "rounded-l-none" : "rounded-l"} ${cols.clippedEnd ? "rounded-r-none" : "rounded-r"} ${chipClass(t)}`}
                          >
                            {t.title}
                          </Link>
                        );
                      })}
                    </div>
                    {undated.length > 0 && (
                      <p className="text-muted-foreground mt-1 px-1 text-xs">
                        No dates:{" "}
                        {undated.map((t, i) => (
                          <span key={t.id}>
                            {i > 0 && ", "}
                            <Link href={`/tasks/${t.id}`} className="underline">{t.title}</Link>
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
