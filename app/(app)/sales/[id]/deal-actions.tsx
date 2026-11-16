"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { archiveDeal, restoreDeal } from "@/lib/actions/deal";

export function DealArchiveButton({ id, title, archived }: { id: string; title: string; archived: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const res = archived ? await restoreDeal({ id }) : await archiveDeal({ id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(archived ? "Deal restored" : "Deal archived");
      setOpen(false);
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => { setError(null); setOpen(true); }}>
        {archived ? <ArchiveRestoreIcon aria-hidden /> : <ArchiveIcon aria-hidden />} {archived ? "Restore" : "Archive"}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{archived ? `Restore ${title}?` : `Archive ${title}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {archived
                ? "It comes back onto the board. Nothing was deleted."
                : "It leaves the board and the reports' open counts but its history stays. Only won or lost deals can be archived."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(e) => { e.preventDefault(); toggle(); }}>
              {pending && <Spinner />} {archived ? "Restore" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
