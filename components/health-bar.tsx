import { cn } from "cn";
import { TONE_SOLID, TONE_TEXT, type Tone } from "@/lib/tone";
import type { HealthSummary } from "@/lib/task-health";

const SEGMENTS: { key: keyof Omit<HealthSummary, "total" | "attention">; label: string; tone: Tone }[] = [
  { key: "overdue", label: "Overdue", tone: "red" },
  { key: "atRisk", label: "At risk", tone: "orange" },
  { key: "dueToday", label: "Due today", tone: "amber" },
  { key: "soon", label: "Due in 3 days", tone: "blue" },
  { key: "onTrack", label: "On track", tone: "green" },
  { key: "later", label: "Later", tone: "slate" },
  { key: "noDate", label: "No deadline", tone: "slate" },
];

/** A stacked bar of open tasks by health, worst on the left. With `legend` it also lists the counts. */
export function HealthBar({ summary, legend = false, className }: { summary: HealthSummary; legend?: boolean; className?: string }) {
  const parts = SEGMENTS.map((s) => ({ ...s, n: summary[s.key] })).filter((s) => s.n > 0);
  const text = parts.length ? parts.map((s) => `${s.n} ${s.label.toLowerCase()}`).join(", ") : "No open tasks";
  return (
    <div className={cn("space-y-2", className)}>
      <div role="img" aria-label={`Open tasks by health: ${text}`} className="bg-muted flex h-2 w-full overflow-hidden rounded-full">
        {parts.map((s, i) => (
          <span
            key={s.key}
            title={`${s.n} ${s.label.toLowerCase()}`}
            style={{ width: `${(s.n / summary.total) * 100}%` }}
            className={cn(TONE_SOLID[s.tone], s.key === "noDate" && "opacity-50", i > 0 && "border-l border-white/60 dark:border-black/40")}
          />
        ))}
      </div>
      {legend && parts.length > 0 && (
        <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {parts.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2 rounded-full", TONE_SOLID[s.tone], s.key === "noDate" && "opacity-50")} />
              <span className={cn("font-medium tabular-nums", TONE_TEXT[s.tone])}>{s.n}</span> {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A one-line health summary above a list: the headline count, then the bar and legend. Renders nothing when no task is open. */
export function HealthStrip({ summary, caption }: { summary: HealthSummary; caption: string }) {
  if (summary.total === 0) return null;
  return (
    <div className="mb-4 space-y-2 rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">
          {summary.attention ? `${summary.attention} ${summary.attention === 1 ? "task needs" : "tasks need"} attention` : "Nothing is late or at risk"}
        </span>
        <span className="text-muted-foreground text-xs">{caption}</span>
      </div>
      <HealthBar summary={summary} legend />
    </div>
  );
}
