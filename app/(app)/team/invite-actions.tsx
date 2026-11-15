"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { resendInvite, revokeInvite } from "@/lib/actions/team";

export function InviteActions({ inviteId, email, expired }: { inviteId: string; email: string; expired: boolean }) {
  const [resending, startResend] = useTransition();
  const [revoking, startRevoke] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex justify-end gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={resending}
        onClick={() =>
          startResend(async () => {
            const res = await resendInvite({ invite_id: inviteId });
            if (res.ok) toast.success(`Invite for ${email} renewed for 30 days`);
            else toast.error(res.error);
          })
        }
      >
        {resending && <Spinner />} {expired ? "Renew" : "Extend"}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setError(null);
        }}
      >
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm">Revoke</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke the invite for {email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Signing in with this email will no longer grant access. You can invite them again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revoking}
              onClick={(e) => {
                e.preventDefault();
                startRevoke(async () => {
                  const res = await revokeInvite({ invite_id: inviteId });
                  if (!res.ok) return setError(res.error);
                  toast.success(`Invite for ${email} revoked`);
                  setOpen(false);
                });
              }}
            >
              {revoking && <Spinner />} Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
