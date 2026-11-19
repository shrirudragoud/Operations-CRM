"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PauseIcon, PlayIcon, Trash2Icon } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteRecurrence, setRecurrenceActive } from "@/lib/actions/task-collab";

export function FixedRowActions({ id, title, active }: { id: string; title: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await setRecurrenceActive({ id, active: !active });
            if (!res.ok) toast.error(res.error);
            else toast.success(active ? "Paused. No new tasks until you resume it." : "Resumed");
          })
        }
      >
        {active ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />} {active ? "Pause" : "Resume"}
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirm(true)} aria-label={`Delete ${title}`}>
        <Trash2Icon aria-hidden /> Delete
      </Button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this fixed task?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{title}&rdquo; stops creating tasks. Tasks it already created stay on people&apos;s lists. To stop it for a while, pause it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  const res = await deleteRecurrence({ id });
                  if (!res.ok) toast.error(res.error);
                  else {
                    toast.success("Fixed task deleted");
                    setConfirm(false);
                  }
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
