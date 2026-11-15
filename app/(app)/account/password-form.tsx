"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/utils/supabase/client";

const schema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords don't match." });
type Values = z.input<typeof schema>;

export function PasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: Values) {
    setError(null);
    const { error } = await createClient().auth.updateUser({ password: values.password });
    if (error) {
      setError(error.message || "Couldn't update the password. Try again.");
      return;
    }
    toast.success("Password updated");
    form.reset();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-sm">
      <FieldGroup>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input id="new-password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...form.register("password")} />
          <FieldError errors={[errors.password]} />
        </Field>
        <Field data-invalid={!!errors.confirm}>
          <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
          <Input id="confirm-password" type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...form.register("confirm")} />
          <FieldError errors={[errors.confirm]} />
        </Field>
        {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner />} Save password</Button>
      </FieldGroup>
    </form>
  );
}
