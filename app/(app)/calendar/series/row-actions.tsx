"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PauseIcon, PlayIcon, Trash2Icon } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteSeries, setSeriesActive } from "@/lib/actions/meeting";

export function SeriesRowActions({ id, title, active }: { id: string; title: string; active: boolean }) {
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
            const res = await setSeriesActive({ id, active: !active });
            if (!res.ok) toast.error(res.error);
            else toast.success(active ? "Paused. Upcoming meetings are removed from the calendar." : "Resumed. The next weeks are back on the calendar.");
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
            <AlertDialogTitle>Delete this fixed meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{title}&rdquo; stops repeating and its upcoming meetings are removed. Meetings you changed or cancelled stay on the calendar. To stop it for a while, pause it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  const res = await deleteSeries({ id });
                  if (!res.ok) toast.error(res.error);
                  else {
                    toast.success("Fixed meeting deleted");
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
