"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Calendar, CalendarDay, CalendarGrid, CalendarHeading, CalendarNext, CalendarPrevious, CalendarWeekday, CalendarWeekdays, CalendarWeeks,
} from "@ui-sdk/react/calendar";
import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { TONE_CHIP, type Tone } from "@/lib/tone";

/** One day, already worked out on the server so the browser needs no office settings. */
export type MonthCell = {
  date: string;
  /** Full sentence for assistive technology, e.g. "Late, 22 min late". */
  label: string;
  short: string;
  tone: Tone;
  worked: string;
};

/** The month as a read-only ui-sdk Calendar. Previous and Next change the address, so the server fetches the new month. */
export function MonthGrid({ month, today, cells }: { month: string; today: string; cells: MonthCell[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const byDate = new Map(cells.map((c) => [c.date, c]));

  return (
    <div aria-busy={pending} className={cn("transition-opacity", pending && "opacity-60")}>
      <Calendar
        readOnly
        month={month}
        today={today}
        weekStartsOn={1}
        weekdayFormat="short"
        showOutsideDays={false}
        onMonthChange={(next) => startTransition(() => router.push(`/me/attendance?month=${next}`, { scroll: false }))}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <CalendarPrevious
            aria-label="Previous month"
            className="hover:bg-muted focus-visible:ring-ring/50 inline-flex size-9 items-center justify-center rounded-md border outline-none focus-visible:ring-[3px]"
          >
            <ChevronLeftIcon aria-hidden className="size-4" />
          </CalendarPrevious>
          <CalendarHeading className="text-base font-semibold" />
          <CalendarNext
            aria-label="Next month"
            className="hover:bg-muted focus-visible:ring-ring/50 inline-flex size-9 items-center justify-center rounded-md border outline-none focus-visible:ring-[3px]"
          >
            <ChevronRightIcon aria-hidden className="size-4" />
          </CalendarNext>
        </div>
        <CalendarGrid className="w-full table-fixed border-separate border-spacing-1">
          <CalendarWeekdays>
            {(index) => <CalendarWeekday index={index} className="text-muted-foreground pb-1 text-center text-xs font-medium" />}
          </CalendarWeekdays>
          <CalendarWeeks>
            {(cell) => {
              const info = byDate.get(cell.date);
              return (
                <CalendarDay
                  value={cell.date}
                  aria-label={info ? `${cell.date}: ${info.label}` : undefined}
                  className="focus-visible:ring-ring/50 data-[today]:ring-primary h-16 rounded-md border align-top outline-none focus-visible:ring-[3px] data-[today]:ring-2 sm:h-20"
                >
                  {(state) => (
                    <span className="flex h-full flex-col items-start gap-0.5 p-1 text-left">
                      <span className="text-xs font-semibold tabular-nums">{state.label}</span>
                      {info && info.short && (
                        <span className={cn("max-w-full truncate rounded border px-1 text-[10px] leading-4 font-medium sm:text-xs", TONE_CHIP[info.tone])}>{info.short}</span>
                      )}
                      {info && info.worked && <span className="text-muted-foreground hidden text-[11px] tabular-nums sm:inline">{info.worked}</span>}
                    </span>
                  )}
                </CalendarDay>
              );
            }}
          </CalendarWeeks>
        </CalendarGrid>
      </Calendar>
    </div>
  );
}
