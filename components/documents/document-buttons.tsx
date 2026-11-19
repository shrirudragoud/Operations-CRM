"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, ExternalLinkIcon, Trash2Icon } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  acknowledgeDocument, deleteStaffDocument, openCompanyDocument, openStaffDocument, retireCompanyDocument, verifyStaffDocument,
} from "@/lib/actions/documents";

export function OpenButton({ id, title, company = false }: { id: string; title: string; company?: boolean }) {
  const [pending, start] = useTransition();
  function open() {
    start(async () => {
      const res = await (company ? openCompanyDocument(id) : openStaffDocument(id));
      if (!res.ok) return void toast.error(res.error);
      window.open(res.data.url, "_blank", "noopener,noreferrer");
    });
  }
  return (
    <Button variant="outline" size="sm" onClick={open} disabled={pending} aria-label={`Open ${title}`}>
      {pending ? <Spinner /> : <ExternalLinkIcon aria-hidden />} Open
    </Button>
  );
}

export function AcknowledgeButton({ id, title }: { id: string; title: string }) {
  const [pending, start] = useTransition();
  function ack() {
    start(async () => {
      const res = await acknowledgeDocument(id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Marked as read");
    });
  }
  return (
    <Button size="sm" onClick={ack} disabled={pending} aria-label={`I have read ${title}`}>
      {pending ? <Spinner /> : <CheckIcon aria-hidden />} I have read this
    </Button>
  );
}

export function RemoveButton({ id, title, retire = false }: { id: string; title: string; retire?: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function remove() {
    setError(null);
    start(async () => {
      const res = await (retire ? retireCompanyDocument(id) : deleteStaffDocument(id));
      if (!res.ok) return setError(res.error);
      toast.success(retire ? `${title} is no longer published` : `${title} was removed`);
      setOpen(false);
    });
  }
  const verb = retire ? "Retire" : "Remove";
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`${verb} ${title}`}>
        <Trash2Icon aria-hidden /> {verb}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{verb} {title}?</AlertDialogTitle>
            <AlertDialogDescription>
              {retire ? "People will no longer see it in the library. Past acknowledgements are kept." : "The file is deleted. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); remove(); }} disabled={pending}>
              {pending && <Spinner />} {verb}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function VerifyButtons({ id, title }: { id: string; title: string }) {
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(ok: boolean) {
    setError(null);
    start(async () => {
      const res = await verifyStaffDocument({ id, ok, note: ok ? undefined : note });
      if (!res.ok) return setError(res.error);
      toast.success(ok ? `${title} verified` : `${title} sent back`);
      setDeclining(false);
      setNote("");
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => send(true)} disabled={pending} aria-label={`Verify ${title}`}>Verify</Button>
      <Button variant="outline" size="sm" onClick={() => setDeclining(true)} aria-label={`Decline ${title}`}>Decline</Button>
      <Dialog open={declining} onOpenChange={setDeclining}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline {title}</DialogTitle>
            <DialogDescription>The person sees your note and can upload a better copy.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`decline-${id}`}>Why</FieldLabel>
            <Textarea id={`decline-${id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
          {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclining(false)}>Cancel</Button>
            <Button onClick={() => send(false)} disabled={pending || note.trim() === ""}>{pending && <Spinner />} Send back</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
