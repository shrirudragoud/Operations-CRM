import { cn } from "cn";
import { Chip } from "@/components/chips";
import { formatDate } from "@/lib/format";
import type { DayLine } from "@/lib/attendance";

/** The month day by day. The calendar gives the picture; this gives every figure, for reading, printing and screen readers. */
export function MonthTable({ days, caption }: { days: DayLine[]; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-3 font-medium">Date</th>
            <th scope="col" className="py-2 pr-3 font-medium">Status</th>
            <th scope="col" className="py-2 pr-3 font-medium">In</th>
            <th scope="col" className="py-2 pr-3 font-medium">Out</th>
            <th scope="col" className="py-2 pr-3 font-medium">Worked</th>
            <th scope="col" className="py-2 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date} className={cn("border-b last:border-0", d.quiet && "text-muted-foreground")}>
              <th scope="row" className="py-2 pr-3 text-left font-normal whitespace-nowrap">
                <span className="tabular-nums">{formatDate(d.date).replace(/ \d{4}$/, "")}</span> <span className="text-muted-foreground">{d.weekday}</span>
              </th>
              <td className="py-2 pr-3">{d.kind === "upcoming" || d.kind === "not_tracked" ? <span aria-label={d.label}>-</span> : <Chip tone={d.tone}>{d.label}</Chip>}</td>
              <td className="py-2 pr-3 tabular-nums">{d.timeIn || "-"}</td>
              <td className="py-2 pr-3 tabular-nums">{d.timeOut || "-"}</td>
              <td className="py-2 pr-3 tabular-nums">{d.worked || "-"}</td>
              <td className="py-2">{d.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
