"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { createInstitution, updateInstitution } from "@/lib/actions/institution";
import {
  INSTITUTION_KINDS, KIND_LABELS, institutionSchema, type InstitutionInput, type InstitutionValues,
} from "@/lib/schemas/institution";
import type { OwnerOption } from "./institution-filters";

const NO_OWNER = "none"; // Radix Select cannot use an empty string as a value.

export type EditableInstitution = {
  id: string;
  name: string;
  kind: InstitutionInput["kind"];
  affiliation: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  source: string | null;
  notes: string | null;
  owner_id: string | null;
};

type Props = {
  institution?: EditableInstitution;
  owners: OwnerOption[];
  /** Partners always own what they create, so they are not offered the choice. */
  showOwner: boolean;
  defaultOwnerId?: string;
  onSaved: (id: string) => void;
  onCancel?: () => void;
};

export function InstitutionForm({ institution, owners, showOwner, defaultOwnerId = "", onSaved, onCancel }: Props) {
  const editing = !!institution;
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<InstitutionInput, unknown, InstitutionValues>({
    resolver: zodResolver(institutionSchema),
    defaultValues: {
      name: institution?.name ?? "",
      kind: institution?.kind ?? ("" as InstitutionInput["kind"]),
      affiliation: institution?.affiliation ?? "",
      city: institution?.city ?? "",
      district: institution?.district ?? "",
      state: institution ? (institution.state ?? "") : "Maharashtra",
      source: institution?.source ?? "",
      notes: institution?.notes ?? "",
      owner_id: institution ? (institution.owner_id ?? "") : defaultOwnerId,
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit() {
    // The action re-parses the raw form values with the same schema.
    const values = form.getValues();
    setServerError(null);
    const res = editing
      ? await updateInstitution({ ...values, id: institution.id })
      : await createInstitution(values);
    if (!res.ok) {
      for (const [key, msgs] of Object.entries(res.fieldErrors ?? {})) {
        form.setError(key as keyof InstitutionInput, { message: msgs[0] });
      }
      setServerError(res.error);
      return;
    }
    toast.success(editing ? "Institution updated" : "Institution created");
    onSaved(editing ? institution.id : (res.data as { id: string }).id);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6" aria-label={editing ? "Edit institution" : "New institution"}>
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="inst-name">Name</FieldLabel>
          <Input id="inst-name" autoComplete="off" aria-invalid={!!errors.name} {...form.register("name")} />
          <FieldError errors={[errors.name]} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.kind}>
            <FieldLabel htmlFor="inst-kind">Kind</FieldLabel>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger id="inst-kind" className="w-full" aria-invalid={!!errors.kind}>
                    <SelectValue placeholder="Choose a kind" />
                  </SelectTrigger>
                  <SelectContent>
                    {INSTITUTION_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.kind]} />
          </Field>
          <Field data-invalid={!!errors.affiliation}>
            <FieldLabel htmlFor="inst-affiliation">Affiliation (optional)</FieldLabel>
            <Input id="inst-affiliation" autoComplete="off" aria-invalid={!!errors.affiliation} {...form.register("affiliation")} />
            <FieldDescription>For example the board or university.</FieldDescription>
            <FieldError errors={[errors.affiliation]} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={!!errors.city}>
            <FieldLabel htmlFor="inst-city">City</FieldLabel>
            <Input id="inst-city" autoComplete="off" aria-invalid={!!errors.city} {...form.register("city")} />
            <FieldError errors={[errors.city]} />
          </Field>
          <Field data-invalid={!!errors.district}>
            <FieldLabel htmlFor="inst-district">District</FieldLabel>
            <Input id="inst-district" autoComplete="off" aria-invalid={!!errors.district} {...form.register("district")} />
            <FieldError errors={[errors.district]} />
          </Field>
          <Field data-invalid={!!errors.state}>
            <FieldLabel htmlFor="inst-state">State</FieldLabel>
            <Input id="inst-state" autoComplete="off" aria-invalid={!!errors.state} {...form.register("state")} />
            <FieldError errors={[errors.state]} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.source}>
            <FieldLabel htmlFor="inst-source">Source (optional)</FieldLabel>
            <Input id="inst-source" autoComplete="off" aria-invalid={!!errors.source} {...form.register("source")} />
            <FieldDescription>How we found them: referral, event, cold call...</FieldDescription>
            <FieldError errors={[errors.source]} />
          </Field>
          {showOwner && (
            <Field data-invalid={!!errors.owner_id}>
              <FieldLabel htmlFor="inst-owner">Owner</FieldLabel>
              <Controller
                control={form.control}
                name="owner_id"
                render={({ field }) => (
                  <Select
                    value={field.value || NO_OWNER}
                    onValueChange={(v) => field.onChange(v === NO_OWNER ? "" : v)}
                  >
                    <SelectTrigger id="inst-owner" className="w-full" aria-invalid={!!errors.owner_id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_OWNER}>Unassigned</SelectItem>
                      {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={[errors.owner_id]} />
            </Field>
          )}
        </div>

        {!editing && (
          <Field data-invalid={!!errors.notes}>
            <FieldLabel htmlFor="inst-notes">Notes (optional)</FieldLabel>
            <Textarea id="inst-notes" rows={4} aria-invalid={!!errors.notes} {...form.register("notes")} />
            <FieldError errors={[errors.notes]} />
          </Field>
        )}
      </FieldGroup>

      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner />} {editing ? "Save changes" : "Create institution"}
        </Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
