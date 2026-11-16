"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { updateEvent } from "@/lib/actions/event";
import { DURATION_DAYS, endForDuration, updateEventSchema, type UpdateEventInput } from "@/lib/schemas/event";

export type EventDetailsValues = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  venue: string;
  expected_headcount: string;
};

export function EventDetailsForm({ initial }: { initial: EventDetailsValues }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<UpdateEventInput, unknown, ReturnType<typeof updateEventSchema.parse>>({
    resolver: zodResolver(updateEventSchema),
    defaultValues: initial,
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  async function onSubmit() {
    setServerError(null);
    const res = await updateEvent(form.getValues());
    if (!res.ok) {
      for (const [key, msgs] of Object.entries(res.fieldErrors ?? {})) {
        form.setError(key as keyof UpdateEventInput, { message: msgs[0] });
      }
      setServerError(res.error);
      return;
    }
    toast.success("Event saved");
    form.reset(form.getValues());
  }

  function fillEnd(days: number) {
    const end = endForDuration(form.getValues("starts_at"), days);
    if (!end) {
      form.setError("starts_at", { message: "Set the start first." });
      return;
    }
    form.clearErrors("starts_at");
    form.setValue("ends_at", end, { shouldDirty: true, shouldValidate: true });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <FieldGroup>
        <Field data-invalid={!!errors.title}>
          <FieldLabel htmlFor="event-title">Title</FieldLabel>
          <Input id="event-title" autoComplete="off" aria-invalid={!!errors.title} {...form.register("title")} />
          <FieldError errors={[errors.title]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.starts_at}>
            <FieldLabel htmlFor="event-start">Starts (India time)</FieldLabel>
            <Input id="event-start" type="datetime-local" aria-invalid={!!errors.starts_at} {...form.register("starts_at")} />
            <FieldError errors={[errors.starts_at]} />
          </Field>
          <Field data-invalid={!!errors.ends_at}>
            <FieldLabel htmlFor="event-end">Ends (India time)</FieldLabel>
            <Input id="event-end" type="datetime-local" aria-invalid={!!errors.ends_at} {...form.register("ends_at")} />
            <FieldError errors={[errors.ends_at]} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Fill the end from the start">
          <span className="text-muted-foreground text-sm">Fill the end for a</span>
          {DURATION_DAYS.map((d) => (
            <Button key={d} type="button" size="sm" variant="outline" onClick={() => fillEnd(d)}>
              {d}-day workshop
            </Button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={!!errors.venue} className="sm:col-span-2">
            <FieldLabel htmlFor="event-venue">Venue</FieldLabel>
            <Input id="event-venue" autoComplete="off" aria-invalid={!!errors.venue} {...form.register("venue")} />
            <FieldError errors={[errors.venue]} />
          </Field>
          <Field data-invalid={!!errors.expected_headcount}>
            <FieldLabel htmlFor="event-headcount">Expected students</FieldLabel>
            <Input id="event-headcount" inputMode="numeric" autoComplete="off" aria-invalid={!!errors.expected_headcount} {...form.register("expected_headcount")} />
            <FieldError errors={[errors.expected_headcount]} />
          </Field>
        </div>
        <FieldDescription>
          Scheduling needs the start, end, venue, expected students and a lead trainer. Pick the trainer after the dates are saved, so only people who are free show up.
        </FieldDescription>
      </FieldGroup>
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={isSubmitting || !isDirty}>{isSubmitting && <Spinner />} Save details</Button>
    </form>
  );
}
