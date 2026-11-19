"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { setOnboardingTask } from "@/lib/actions/hr-requests";

export function ChecklistTick({ id, title, done, disabled = false }: { id: string; title: string; done: boolean; disabled?: boolean }) {
  const [shown, setShown] = useOptimistic(done);
  const [pending, start] = useTransition();

  function change(on: boolean) {
    start(async () => {
      setShown(on);
      const res = await setOnboardingTask({ task_id: id, done: on });
      if (!res.ok) toast.error(res.error);
    });
  }

  return (
    <Checkbox
      checked={shown}
      disabled={disabled || pending}
      onCheckedChange={(on) => change(on === true)}
      aria-label={title}
    />
  );
}
