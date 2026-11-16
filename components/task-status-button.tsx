"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { setTaskStatus } from "@/lib/actions/activity";
import type { TaskStatus } from "@/lib/schemas/activity";

/** One-click status change for a task (default: mark done). The database decides if the caller may. */
export function TaskStatusButton({
  id, title, status = "done", label = "Done",
}: { id: string; title: string; status?: TaskStatus; label?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label={`${label}: ${title}`}
      onClick={() =>
        startTransition(async () => {
          const res = await setTaskStatus({ id, status });
          if (!res.ok) toast.error(res.error);
          else toast.success(status === "done" ? "Marked done" : "Task updated");
        })
      }
    >
      {pending ? <Spinner /> : <CheckIcon aria-hidden />} {label}
    </Button>
  );
}
