"use client";

import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PencilIcon, PlusIcon, Trash2Icon, UserIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createContact, deleteContact, updateContact } from "@/lib/actions/institution";
import {
  INFLUENCES, INFLUENCE_LABELS, contactSchema, type ContactInput, type ContactValues, type Influence,
} from "@/lib/schemas/institution";

const NO_INFLUENCE = "none"; // Radix Select cannot use an empty string as a value.

export type ContactRow = {
  id: string;
  full_name: string;
  designation: string | null;
  influence: Influence | null;
  phone: string | null;
  email: string | null;
};

const EMPTY: ContactInput = { full_name: "", designation: "", influence: "", phone: "", email: "" };

function toInput(c: ContactRow): ContactInput {
  return {
    full_name: c.full_name,
    designation: c.designation ?? "",
    influence: c.influence ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
  };
}

export function ContactsPanel({
  institutionId, contacts, canManage,
}: { institutionId: string; contacts: ContactRow[]; canManage: boolean }) {
  const [editing, setEditing] = useState<ContactRow | "new" | null>(null);
  const [removing, setRemoving] = useState<ContactRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!removing) return;
    const target = removing;
    setRemoveError(null);
    startTransition(async () => {
      const res = await deleteContact({ id: target.id, institution_id: institutionId });
      if (!res.ok) {
        setRemoveError(res.error);
        return;
      }
      toast.success(`${target.full_name} was removed`);
      setRemoving(null);
    });
  }

  return (
    <div className="space-y-4">
      {canManage && contacts.length > 0 && (
        <div>
          <Button onClick={() => setEditing("new")}><PlusIcon aria-hidden /> Add contact</Button>
        </div>
      )}

      {contacts.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><UserIcon aria-hidden /></EmptyMedia>
            <EmptyTitle>No contacts yet</EmptyTitle>
            <EmptyDescription>
              {canManage
                ? "Add the principal, HOD or whoever you deal with, so the next person knows who to call."
                : "Nobody has added a contact for this institution."}
            </EmptyDescription>
          </EmptyHeader>
          {canManage && (
            <EmptyContent>
              <Button onClick={() => setEditing("new")}><PlusIcon aria-hidden /> Add contact</Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <Table aria-label="Contacts">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Influence</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              {canManage && <TableHead><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="font-medium">{c.full_name}</div>
                  {c.designation && <div className="text-muted-foreground text-xs">{c.designation}</div>}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {c.influence ? <Badge variant="outline">{INFLUENCE_LABELS[c.influence]}</Badge> : <span className="text-muted-foreground">-</span>}
                </TableCell>
                <TableCell>
                  {c.phone ? <a className="underline-offset-4 hover:underline" href={`tel:${c.phone}`}>{c.phone}</a> : <span className="text-muted-foreground">-</span>}
                </TableCell>
                <TableCell className="hidden break-all md:table-cell">
                  {c.email ? <a className="underline-offset-4 hover:underline" href={`mailto:${c.email}`}>{c.email}</a> : <span className="text-muted-foreground">-</span>}
                </TableCell>
                {canManage && (
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${c.full_name}`} onClick={() => setEditing(c)}>
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${c.full_name}`}
                      onClick={() => {
                        setRemoveError(null);
                        setRemoving(c);
                      }}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ContactDialog
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.id}
        institutionId={institutionId}
        target={editing}
        onClose={() => setEditing(null)}
      />

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the contact from this institution. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{removeError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                remove();
              }}
            >
              {pending && <Spinner />} Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ContactDialog({
  institutionId, target, onClose,
}: { institutionId: string; target: ContactRow | "new" | null; onClose: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const existing = target && target !== "new" ? target : null;
  const form = useForm<ContactInput, unknown, ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: existing ? toInput(existing) : EMPTY,
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit() {
    const values = form.getValues();
    setServerError(null);
    const res = existing
      ? await updateContact({ ...values, id: existing.id, institution_id: institutionId })
      : await createContact({ ...values, institution_id: institutionId });
    if (!res.ok) {
      for (const [key, msgs] of Object.entries(res.fieldErrors ?? {})) {
        form.setError(key as keyof ContactInput, { message: msgs[0] });
      }
      setServerError(res.error);
      return;
    }
    toast.success(existing ? "Contact updated" : "Contact added");
    onClose();
  }

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{existing ? "Edit contact" : "Add contact"}</DialogTitle>
            <DialogDescription>Someone at this institution we speak to.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!errors.full_name}>
              <FieldLabel htmlFor="contact-name">Name</FieldLabel>
              <Input id="contact-name" autoComplete="off" aria-invalid={!!errors.full_name} {...form.register("full_name")} />
              <FieldError errors={[errors.full_name]} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.designation}>
                <FieldLabel htmlFor="contact-designation">Designation</FieldLabel>
                <Input id="contact-designation" autoComplete="off" aria-invalid={!!errors.designation} {...form.register("designation")} />
                <FieldError errors={[errors.designation]} />
              </Field>
              <Field data-invalid={!!errors.influence}>
                <FieldLabel htmlFor="contact-influence">Influence</FieldLabel>
                <Controller
                  control={form.control}
                  name="influence"
                  render={({ field }) => (
                    <Select
                      value={field.value || NO_INFLUENCE}
                      onValueChange={(v) => field.onChange(v === NO_INFLUENCE ? "" : v)}
                    >
                      <SelectTrigger id="contact-influence" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_INFLUENCE}>Not set</SelectItem>
                        {INFLUENCES.map((i) => <SelectItem key={i} value={i}>{INFLUENCE_LABELS[i]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError errors={[errors.influence]} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.phone}>
                <FieldLabel htmlFor="contact-phone">Phone</FieldLabel>
                <Input id="contact-phone" type="tel" autoComplete="off" aria-invalid={!!errors.phone} {...form.register("phone")} />
                <FieldError errors={[errors.phone]} />
              </Field>
              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="contact-email">Email</FieldLabel>
                <Input id="contact-email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...form.register("email")} />
                <FieldError errors={[errors.email]} />
              </Field>
            </div>
          </FieldGroup>
          {serverError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Spinner />} {existing ? "Save contact" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
