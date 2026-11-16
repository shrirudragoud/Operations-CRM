"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { toggleRunSheetItem } from "@/lib/actions/event";
import { formatDateTime } from "@/lib/format";
import { RUN_PHASES, RUN_PHASE_LABELS, runSheetProgress } from "@/lib/schemas/event";

export type RunItem = { id: string; phase: string; label: string; done_at: string | null; doneBy: string | null };

/** The event checklist. Ticking stamps who and when in the database; "pre" and "day" items block completing the event. */
export function RunSheet({ items, editable }: { items: RunItem[]; editable: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const progress = runSheetProgress(items);

  function toggle(item: RunItem, done: boolean) {
    setBusy(item.id);
    startTransition(async () => {
      const res = await toggleRunSheetItem({ id: item.id, done });
      if (!res.ok) toast.error(res.error);
      setBusy(null);
    });
  }

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">The checklist is added when the event is scheduled.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {progress.done} of {progress.total} done
        {progress.blocking > 0 ? ` · ${progress.blocking} must be finished before the event can be completed` : ""}
      </p>
      {RUN_PHASES.map((phase) => {
        const rows = items.filter((i) => i.phase === phase);
        if (rows.length === 0) return null;
        return (
          <section key={phase} aria-label={RUN_PHASE_LABELS[phase]}>
            <h3 className="mb-2 text-sm font-semibold">{RUN_PHASE_LABELS[phase]}</h3>
            <ul className="divide-y rounded-lg border">
              {rows.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-3 py-2">
                  <Checkbox
                    id={`run-${item.id}`}
                    checked={item.done_at !== null}
                    disabled={!editable || busy === item.id}
                    onCheckedChange={(v) => toggle(item, v === true)}
                    className="mt-0.5"
                  />
                  <label htmlFor={`run-${item.id}`} className="min-w-0 flex-1 text-sm">
                    <span className={item.done_at ? "text-muted-foreground line-through" : ""}>{item.label}</span>
                    {item.done_at && (
                      <span className="text-muted-foreground block text-xs">
                        {item.doneBy ?? "Someone"} · {formatDateTime(item.done_at)}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
