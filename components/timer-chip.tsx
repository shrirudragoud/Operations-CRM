"use client";

import { useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { SquareIcon, TimerIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stopTimer } from "@/lib/actions/time";
import { elapsedMinutes, formatHM } from "@/lib/schemas/time";

const TICK_MS = 30_000;

function subscribe(onTick: () => void) {
  const t = setInterval(onTick, TICK_MS);
  return () => clearInterval(t);
}
const bucket = () => Math.floor(Date.now() / TICK_MS);

/** Minutes a running timer has been going, refreshed every 30 seconds. Null on the server and first paint, so nothing mismatches. */
export function useElapsedMinutes(startedAt: string): number | null {
  const tick = useSyncExternalStore(subscribe, bucket, () => null);
  return tick === null ? null : elapsedMinutes(startedAt, tick * TICK_MS);
}

export function Elapsed({ startedAt }: { startedAt: string }) {
  const m = useElapsedMinutes(startedAt);
  return <span suppressHydrationWarning>{m === null ? "..." : formatHM(m)}</span>;
}

export type RunningTimerView = { id: string; taskId: string; title: string; startedAt: string };

/** The timer that is running for me, shown in the header on every page with a Stop button. */
export function TimerChip({ timer }: { timer: RunningTimerView }) {
  const [pending, startTransition] = useTransition();

  function stop() {
    startTransition(async () => {
      const res = await stopTimer({ id: timer.id });
      if (!res.ok) toast.error(res.error);
      else toast.success("Timer stopped");
    });
  }

  return (
    <div className="bg-muted flex max-w-72 items-center gap-1 rounded-full py-0.5 pr-1 pl-3 text-sm" role="status" aria-label={`Timer running on ${timer.title}`}>
      <TimerIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <Link href={`/tasks/${timer.taskId}`} className="truncate underline-offset-4 hover:underline">{timer.title}</Link>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums"><Elapsed startedAt={timer.startedAt} /></span>
      <Button variant="ghost" size="icon-sm" className="size-7 shrink-0 rounded-full" aria-label={`Stop the timer on ${timer.title}`} disabled={pending} onClick={stop}>
        <SquareIcon aria-hidden />
      </Button>
    </div>
  );
}
