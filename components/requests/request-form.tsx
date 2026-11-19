"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { createHrRequest } from "@/lib/actions/hr-requests";
import { REQUEST_KINDS, REQUEST_LABELS, requestSchema, type RequestInput } from "@/lib/schemas/hr-requests";

const EMPTY: RequestInput = { kind: "experience_letter", subject: "", details: "" };

export function RequestForm() {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<RequestInput>({ resolver: zodResolver(requestSchema), defaultValues: EMPTY });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: RequestInput) {
    setError(null);
    const res = await createHrRequest(values);
    if (!res.ok) return setError(res.error);
    toast.success("Request sent to HR");
    form.reset(EMPTY);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-2xl">
      <FieldGroup>
        <Field data-invalid={!!errors.kind}>
          <FieldLabel htmlFor="rq-kind">What do you need</FieldLabel>
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="rq-kind" aria-label="What do you need" className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REQUEST_KINDS.map((k) => <SelectItem key={k} value={k}>{REQUEST_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field data-invalid={!!errors.subject}>
          <FieldLabel htmlFor="rq-subject">Subject</FieldLabel>
          <Input id="rq-subject" autoComplete="off" aria-invalid={!!errors.subject} {...form.register("subject")} />
          <FieldError errors={[errors.subject]} />
        </Field>
        <Field data-invalid={!!errors.details}>
          <FieldLabel htmlFor="rq-details">Details (optional)</FieldLabel>
          <Textarea id="rq-details" rows={3} aria-invalid={!!errors.details} {...form.register("details")} />
          <FieldError errors={[errors.details]} />
        </Field>
        {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
        <Button type="submit" disabled={isSubmitting} className="w-fit">{isSubmitting && <Spinner />} Send to HR</Button>
      </FieldGroup>
    </form>
  );
}
