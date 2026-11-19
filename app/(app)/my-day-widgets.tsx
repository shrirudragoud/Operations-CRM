import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import { Card } from "@/components/ui/card";
import { TONE_PANEL, TONE_SOLID, TONE_TEXT, type Tone } from "@/lib/tone";
import { formatHM, weekDays } from "@/lib/schemas/time";

/** One number that matters, with an icon and a colour that says whether it needs attention. */
export function StatCard({
  icon: Icon, tone, label, value, hint,
}: { icon: LucideIcon; tone: Tone; label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className={cn("gap-1 border-0 px-4 py-3 shadow-none ring-1 ring-black/5 dark:ring-white/10", TONE_PANEL[tone])}>
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <Icon aria-hidden className={cn("size-4", TONE_TEXT[tone])} />
        {label}
      </div>
      <div className={cn("text-2xl leading-tight font-semibold tabular-nums", TONE_TEXT[tone])}>{value}</div>
      {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
    </Card>
  );
}

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Hours tracked on each day of the week. A full bar is eight hours. */
export function WeekBars({ weekStart, today, minutesByDay }: { weekStart: string; today: string; minutesByDay: Record<string, number> }) {
  const days = weekDays(weekStart);
  const total = days.reduce((s, d) => s + (minutesByDay[d] ?? 0), 0);
  return (
    <div>
      <div className="flex h-24 items-end gap-2" role="img" aria-label={`Time tracked this week: ${formatHM(total)}`}>
        {days.map((d, i) => {
          const m = minutesByDay[d] ?? 0;
          const pct = Math.min(100, Math.round((m / 480) * 100));
          return (
            <div key={d} className="flex flex-1 flex-col items-center justify-end gap-1">
              <div className="bg-muted relative flex h-16 w-full items-end overflow-hidden rounded">
                <div className={cn("w-full rounded", d === today ? TONE_SOLID.blue : TONE_SOLID.slate)} style={{ height: `${Math.max(m > 0 ? 6 : 0, pct)}%` }} title={`${DAY_SHORT[i]}: ${formatHM(m)}`} />
              </div>
              <span className={cn("text-[11px]", d === today ? "font-semibold" : "text-muted-foreground")}>{DAY_SHORT[i]}</span>
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">This week: <span className="text-foreground font-medium">{formatHM(total)}</span></p>
    </div>
  );
}
