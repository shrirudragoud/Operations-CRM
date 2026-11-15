"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { UserPlusIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { inviteStaff } from "@/lib/actions/team";
import { inviteSchema, type InviteInput } from "@/lib/schemas/team";
import { AccessFields } from "./access-fields";

const EMPTY: InviteInput = { email: "", full_name: "", role: "member", departments: [] };

export function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<InviteInput>({ resolver: zodResolver(inviteSchema), defaultValues: EMPTY });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: InviteInput) {
    setServerError(null);
    const res = await inviteStaff(values);
    if (!res.ok) {
      for (const [key, msgs] of Object.entries(res.fieldErrors ?? {})) {
        form.setError(key as keyof InviteInput, { message: msgs[0] });
      }
      setServerError(res.error);
      return;
    }
    toast.success(`Invite created for ${res.data.email}`, {
      description: "Share the app link. Their first sign-in with this email accepts the invite (valid 30 days).",
    });
    form.reset(EMPTY);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          form.reset(EMPTY);
          setServerError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button><UserPlusIcon aria-hidden /> Invite</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>Invite a teammate or partner</DialogTitle>
            <DialogDescription>
              They get access the first time they sign in with this email (Google or email link).
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input id="invite-email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...form.register("email")} />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field data-invalid={!!errors.full_name}>
              <FieldLabel htmlFor="invite-name">Name (optional)</FieldLabel>
              <Input id="invite-name" autoComplete="off" aria-invalid={!!errors.full_name} {...form.register("full_name")} />
              <FieldError errors={[errors.full_name]} />
            </Field>
            <AccessFields control={form.control} errors={errors} setValue={form.setValue} idPrefix="invite" />
          </FieldGroup>
          {serverError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Spinner />} Create invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
