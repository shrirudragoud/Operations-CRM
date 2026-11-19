"use client";

import { useState, useTransition } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cancelLeave, decideLeave } from "@/lib/actions/leave";

export function WithdrawButton({ id, what }: { id: string; what: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label={`Withdraw ${what}`}
      onClick={() =>
        start(async () => {
          const res = await cancelLeave({ id });
          if (res.ok) toast.success("Leave withdrawn");
          else toast.error(res.error);
        })
      }
    >
      {pending && <Spinner />} Withdraw
    </Button>
  );
}

/** Approve at once, or turn down with a reason the person will read. */
export function DecideButtons({ id, who }: { id: string; who: string }) {
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function approve() {
    start(async () => {
      const res = await decideLeave({ id, approve: true });
      if (res.ok) toast.success(`Approved for ${who}`);
      else toast.error(res.error);
    });
  }

  function reject() {
    setError(null);
    start(async () => {
      const res = await decideLeave({ id, approve: false, note });
      if (!res.ok) {
        setError(res.fieldErrors?.note?.[0] ?? res.error);
        return;
      }
      toast.success(`Turned down for ${who}`);
      setRejecting(false);
      setNote("");
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={pending} aria-label={`Approve leave for ${who}`} onClick={approve}>
        {pending ? <Spinner /> : <CheckIcon aria-hidden />} Approve
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} aria-label={`Turn down leave for ${who}`} onClick={() => setRejecting(true)}>
        <XIcon aria-hidden /> Turn down
      </Button>
      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Turn down leave for {who}</DialogTitle>
            <DialogDescription>They will see your reason, so keep it short and kind.</DialogDescription>
          </DialogHeader>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor={`reject-${id}`}>Reason</FieldLabel>
            <Textarea id={`reject-${id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!error} />
          </Field>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejecting(false)}>Cancel</Button>
            <Button type="button" disabled={pending} onClick={reject}>{pending && <Spinner />} Turn down</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
