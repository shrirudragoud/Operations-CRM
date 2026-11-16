"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { InstitutionPicker } from "@/components/institution-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { createEvent } from "@/lib/actions/event";
import { createEventSchema, EVENT_KINDS, EVENT_KIND_LABELS, type CreateEventInput } from "@/lib/schemas/event";

/**
 * Add an event by hand (a demo, a STEM class, anything that did not come from a won deal). Events from won
 * deals are created by the database and show up under "Needs scheduling". The new event starts as a draft.
 */
export function NewEventButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}><PlusIcon aria-hidden /> New event</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <EventForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function EventForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<CreateEventInput, unknown, ReturnType<typeof createEventSchema.parse>>({
    resolver: zodResolver(createEventSchema),
    defaultValues: { institution_id: "", kind: "college_workshop", title: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit() {
    setServerError(null);
    const res = await createEvent(form.getValues());
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [key, msgs] of fields) form.setError(key as keyof CreateEventInput, { message: msgs[0] });
      if (fields.length === 0) setServerError(res.error);
      return;
    }
    toast.success("Event created. Set the date, venue and trainer to schedule it.");
    onDone();
    router.push(`/workshop/${res.data.id}`);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <DialogHeader>
        <DialogTitle>New event</DialogTitle>
        <DialogDescription>It starts as a draft. Add the date, venue and trainer on the next screen.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!errors.institution_id}>
          <FieldLabel htmlFor="event-institution">Institution</FieldLabel>
          <Controller
            control={form.control}
            name="institution_id"
            render={({ field }) => <InstitutionPicker id="event-institution" value={field.value} onChange={field.onChange} invalid={!!errors.institution_id} />}
          />
          <FieldError errors={[errors.institution_id]} />
        </Field>
        <Field data-invalid={!!errors.kind}>
          <FieldLabel htmlFor="event-kind">Event type</FieldLabel>
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="event-kind" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_KINDS.map((k) => <SelectItem key={k} value={k}>{EVENT_KIND_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError errors={[errors.kind]} />
        </Field>
        <Field data-invalid={!!errors.title}>
          <FieldLabel htmlFor="event-title">Title (optional)</FieldLabel>
          <Input id="event-title" autoComplete="off" placeholder="Filled in from the type and institution" aria-invalid={!!errors.title} {...form.register("title")} />
          <FieldDescription>Workshops from won deals are created for you; use this for everything else.</FieldDescription>
          <FieldError errors={[errors.title]} />
        </Field>
      </FieldGroup>
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} Create event</Button>
      </DialogFooter>
    </form>
  );
}
