import Link from "next/link";
import type { HeatWeek, PersonRow } from "@/lib/ops-insight";

// Two grids drawn with plain markup so they render on the server and read well to a screen reader.

const LEVEL = [
  "bg-muted",
  "bg-emerald-200 dark:bg-emerald-950",
  "bg-emerald-300 dark:bg-emerald-800",
  "bg-emerald-500 dark:bg-emerald-600",
  "bg-emerald-700 dark:bg-emerald-400",
];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const dayLabel = (ymd: string): string =>
  new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

/** One square per day, a column per week, darker for more finished work. */
export function CalendarHeatmap({ weeks, summary }: { weeks: HeatWeek[]; summary: string }) {
  return (
    <figure aria-label="Work finished per day, last twelve weeks">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <div aria-hidden className="text-muted-foreground flex flex-col gap-1 pt-0 text-[10px] leading-4">
          {DAY_NAMES.map((d) => (
            <span key={d} className="h-4">{d}</span>
          ))}
        </div>
        {weeks.map((w) => (
          <div key={w.start} className="flex flex-col gap-1">
            {w.cells.map((c) => (
              <span
                key={c.day}
                title={c.future ? dayLabel(c.day) : `${dayLabel(c.day)}: ${c.count} finished`}
                className={`size-4 rounded-sm ${c.future ? "bg-transparent" : LEVEL[c.level]} ${c.weekend && !c.future && c.count === 0 ? "opacity-40" : ""}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div aria-hidden className="text-muted-foreground mt-2 flex items-center gap-1 text-xs">
        Fewer
        {LEVEL.map((l) => (
          <span key={l} className={`size-3 rounded-sm ${l}`} />
        ))}
        More
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

function rateClass(rate: number | null, done: number): string {
  if (done === 0) return "bg-muted text-muted-foreground";
  if (rate === null) return "bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100";
  if (rate >= 80) return "bg-emerald-200 text-emerald-950 dark:bg-emerald-900 dark:text-emerald-100";
  if (rate >= 50) return "bg-amber-200 text-amber-950 dark:bg-amber-900 dark:text-amber-100";
  return "bg-red-200 text-red-950 dark:bg-red-900 dark:text-red-100";
}

/** People down, weeks across. The number is what they finished; the colour is how much of it was on time. */
export function PeopleHeatmap({ rows, taskLink }: { rows: PersonRow[]; taskLink: (id: string) => string }) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">No one to show.</p>;
  const heads = rows[0]!.weeks;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Tasks finished per person per week; the colour shows the share finished on time or early</caption>
          <thead>
            <tr>
              <th scope="col" className="text-muted-foreground py-1 pr-3 text-left text-xs font-normal">Person</th>
              {heads.map((w) => (
                <th key={w.start} scope="col" className="text-muted-foreground px-0.5 py-1 text-center text-xs font-normal whitespace-nowrap">{w.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="py-0.5 pr-3 text-left font-normal whitespace-nowrap">
                  <Link className="underline-offset-4 hover:underline" href={taskLink(r.id)}>{r.name}</Link>
                </th>
                {r.weeks.map((w) => (
                  <td key={w.start} className="px-0.5 py-0.5">
                    <span
                      title={`${r.name}, week of ${w.label}: ${w.done} finished${w.onTimeRate === null ? "" : `, ${w.onTimeRate}% on time (${w.withDeadline} with a deadline)`}`}
                      className={`block min-w-9 rounded-sm py-1 text-center text-xs tabular-nums ${rateClass(w.onTimeRate, w.done)}`}
                    >
                      {w.done}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span><span aria-hidden className="mr-1 inline-block size-2.5 rounded-sm bg-emerald-300 align-middle" />80% or more on time</span>
        <span><span aria-hidden className="mr-1 inline-block size-2.5 rounded-sm bg-amber-300 align-middle" />50 to 79%</span>
        <span><span aria-hidden className="mr-1 inline-block size-2.5 rounded-sm bg-red-300 align-middle" />under 50%</span>
        <span><span aria-hidden className="mr-1 inline-block size-2.5 rounded-sm bg-slate-300 align-middle" />no deadlines</span>
      </p>
    </div>
  );
}
