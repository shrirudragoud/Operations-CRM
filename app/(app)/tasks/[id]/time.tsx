"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ClockPlusIcon, PencilIcon, PlayIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Elapsed } from "@/components/timer-chip";
import { TimeEntryDialog, type EntryDraft } from "@/components/time-entry-dialog";
import { deleteTimeEntry, startTimer, stopTimer } from "@/lib/actions/time";
import { formatHM } from "@/lib/schemas/time";

export type TimeEntryView = {
  id: string;
  who: string;
  day: string;
  /** Raw yyyy-mm-dd, for the edit form. */
  workDate: string;
  minutes: number | null;
  startedAt: string | null;
  note: string | null;
  timed: boolean;
  canEdit: boolean;
};

export type OtherTimer = { taskId: string; title: string };

type Props = {
  taskId: string;
  today: string;
  entries: TimeEntryView[];
  loggedMinutes: number;
  estimateLabel: string;
  estimateMinutes: number | null;
  /** My running timer on this task, if any. */
  myTimerId: string | null;
  /** My running timer on another task, if any. */
  otherTimer: OtherTimer | null;
  canTrack: boolean;
  canStart: boolean;
};

/** Time on a task: the total against the estimate, a timer, and the entries. The database re-checks every change. */
export function TaskTime({ taskId, today, entries, loggedMinutes, estimateLabel, estimateMinutes, myTimerId, otherTimer, canTrack, canStart }: Props) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [lastDraft, setLastDraft] = useState<EntryDraft>({ taskId, workDate: today, length: "", note: "" });

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const res = await action();
      if (!res.ok) toast.error(res.error);
      else toast.success(success);
    });
  }

  function open(d: EntryDraft) {
    setLastDraft(d);
    setDraft(d);
  }

  const over = estimateMinutes !== null && loggedMinutes > estimateMinutes;
  const myRunning = entries.find((e) => e.id === myTimerId);

  return (
    <div className="space-y-4">
      <div className="text-sm">
        <span className={over ? "text-destructive font-medium" : "font-medium"}>{formatHM(loggedMinutes)}</span>
        <span className="text-muted-foreground">{estimateMinutes === null ? " logged, no estimate set" : ` logged of ${estimateLabel} estimated`}</span>
      </div>

      {canTrack && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {myTimerId ? (
              <Button size="sm" disabled={pending} onClick={() => run(() => stopTimer({ id: myTimerId }), "Timer stopped")}>
                <SquareIcon aria-hidden /> Stop timer
                {myRunning?.startedAt && <span className="tabular-nums"><Elapsed startedAt={myRunning.startedAt} /></span>}
              </Button>
            ) : (
              canStart && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => startTimer({ task_id: taskId }), "Timer started")}>
                  <PlayIcon aria-hidden /> Start timer
                </Button>
              )
            )}
            <Button size="sm" variant="outline" onClick={() => open({ taskId, workDate: today, length: "", note: "" })}>
              <ClockPlusIcon aria-hidden /> Log time
            </Button>
          </div>
          {!myTimerId && canStart && otherTimer && (
            <p className="text-muted-foreground text-xs">
              A timer is running on <Link className="underline-offset-4 hover:underline" href={`/tasks/${otherTimer.taskId}`}>{otherTimer.title}</Link>. Starting one here stops it.
            </p>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No time logged yet.</p>
      ) : (
        <ul className="divide-y" aria-label="Time entries">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div>
                  <span className="font-medium">{e.minutes === null && e.startedAt ? <><Elapsed startedAt={e.startedAt} /> (running)</> : formatHM(e.minutes ?? 0)}</span>
                  <span className="text-muted-foreground"> · {e.who} · {e.day}</span>
                </div>
                {e.note && <p className="text-muted-foreground text-xs break-words">{e.note}</p>}
              </div>
              {e.canEdit && e.minutes !== null && (
                <div className="flex shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit the ${formatHM(e.minutes)} entry from ${e.day}`}
                    disabled={pending}
                    onClick={() => open({ id: e.id, taskId, workDate: e.workDate, length: formatHM(e.minutes ?? 0), note: e.note ?? "", timed: e.timed })}
                  >
                    <PencilIcon aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete the ${formatHM(e.minutes)} entry from ${e.day}`}
                    disabled={pending}
                    onClick={() => run(() => deleteTimeEntry({ id: e.id }), "Time removed")}
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <TimeEntryDialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)} draft={draft ?? lastDraft} today={today} />
    </div>
  );
}
