"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { PlayIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { startTimer, stopTimer } from "@/lib/actions/time";

/** Start or stop the timer on a task. Starting one stops any other the person has running; the database does that. */
export function TaskTimerButton({ taskId, title, runningId }: { taskId: string; title: string; runningId: string | null }) {
  const [pending, startTransition] = useTransition();
  const running = runningId !== null;
  return (
    <Button
      variant={running ? "default" : "outline"}
      size="sm"
      disabled={pending}
      aria-label={`${running ? "Stop the timer on" : "Start the timer on"}: ${title}`}
      onClick={() =>
        startTransition(async () => {
          const res = running ? await stopTimer({ id: runningId }) : await startTimer({ task_id: taskId });
          if (!res.ok) toast.error(res.error);
          else toast.success(running ? "Timer stopped" : "Timer started");
        })
      }
    >
      {pending ? <Spinner /> : running ? <SquareIcon aria-hidden /> : <PlayIcon aria-hidden />} {running ? "Stop" : "Start"}
    </Button>
  );
}
