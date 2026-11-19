"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { DateField } from "@/components/date-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { updateDeal } from "@/lib/actions/deal";
import { updateDealSchema, type UpdateDealInput } from "@/lib/schemas/deal";

export type DealDetailsValues = {
  id: string;
  title: string;
  value_inr: string;
  probability: string;
  expected_close: string;
  owner_id: string;
};

export function DealDetailsForm({
  initial, owners,
}: { initial: DealDetailsValues; owners: { id: string; full_name: string }[] | null }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<UpdateDealInput, unknown, ReturnType<typeof updateDealSchema.parse>>({
    resolver: zodResolver(updateDealSchema),
    defaultValues: initial,
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  async function onSubmit() {
    setServerError(null);
    const res = await updateDeal(form.getValues());
    if (!res.ok) {
      for (const [key, msgs] of Object.entries(res.fieldErrors ?? {})) {
        form.setError(key as keyof UpdateDealInput, { message: msgs[0] });
      }
      setServerError(res.error);
      return;
    }
    toast.success("Deal saved");
    form.reset(form.getValues());
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <FieldGroup>
        <Field data-invalid={!!errors.title}>
          <FieldLabel htmlFor="deal-title">Title</FieldLabel>
          <Input id="deal-title" autoComplete="off" aria-invalid={!!errors.title} {...form.register("title")} />
          <FieldError errors={[errors.title]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={!!errors.value_inr}>
            <FieldLabel htmlFor="deal-value">Value (INR)</FieldLabel>
            <Input id="deal-value" inputMode="decimal" autoComplete="off" aria-invalid={!!errors.value_inr} {...form.register("value_inr")} />
            <FieldError errors={[errors.value_inr]} />
          </Field>
          <Field data-invalid={!!errors.probability}>
            <FieldLabel htmlFor="deal-probability">Chance (%)</FieldLabel>
            <Input id="deal-probability" inputMode="numeric" autoComplete="off" aria-invalid={!!errors.probability} {...form.register("probability")} />
            <FieldError errors={[errors.probability]} />
          </Field>
          <Field data-invalid={!!errors.expected_close}>
            <FieldLabel htmlFor="deal-close">Expected close</FieldLabel>
            <Controller control={form.control} name="expected_close" render={({ field }) => <DateField id="deal-close" value={field.value} onChange={field.onChange} invalid={!!errors.expected_close} />} />
            <FieldError errors={[errors.expected_close]} />
          </Field>
        </div>
        {owners && (
          <Field data-invalid={!!errors.owner_id}>
            <FieldLabel htmlFor="deal-owner">Owner</FieldLabel>
            <Controller
              control={form.control}
              name="owner_id"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="deal-owner" className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldDescription>The person accountable for this deal.</FieldDescription>
            <FieldError errors={[errors.owner_id]} />
          </Field>
        )}
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
