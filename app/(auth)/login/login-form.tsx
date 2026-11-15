"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/utils/supabase/client";

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email({ message: "Enter a valid email address." })),
});
type EmailForm = z.input<typeof emailSchema>;

function callbackUrl(next: string) {
  const url = new URL("/auth/callback", window.location.origin);
  if (next !== "/") url.searchParams.set("next", next);
  return url.toString();
}

export function LoginForm({ next }: { next: string }) {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<EmailForm>({ resolver: zodResolver(emailSchema), defaultValues: { email: "" } });

  async function signInWithGoogle() {
    setError(null);
    setGoogleLoading(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl(next), queryParams: { prompt: "select_account" } },
    });
    // On success the browser navigates away; only errors return here.
    if (error) {
      setGoogleLoading(false);
      setError("Couldn't start Google sign-in. Try again or use an email link.");
    }
  }

  async function sendLink(values: EmailForm) {
    setError(null);
    const { email } = emailSchema.parse(values);
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl(next) },
    });
    if (error) {
      setError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "Couldn't send the sign-in link. Check the address and try again.",
      );
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="space-y-3 text-center" role="status">
        <MailCheckIcon className="text-muted-foreground mx-auto size-8" aria-hidden />
        <p className="text-sm">
          We sent a sign-in link to <strong>{sentTo}</strong>. Open it on this device.
        </p>
        <Button variant="ghost" size="sm" onClick={() => setSentTo(null)}>
          Use a different email
        </Button>
      </div>
    );
  }

  const sending = form.formState.isSubmitting;
  return (
    <div className="space-y-4">
      <Button type="button" className="w-full" onClick={signInWithGoogle} disabled={googleLoading || sending}>
        {googleLoading ? <Spinner /> : <GoogleIcon />}
        Continue with Google
      </Button>
      <FieldSeparator>or</FieldSeparator>
      <form onSubmit={form.handleSubmit(sendLink)} noValidate>
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.email}>
            <FieldLabel htmlFor="email">Work email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@hard-code.in"
              aria-invalid={!!form.formState.errors.email}
              {...form.register("email")}
            />
            <FieldError errors={[form.formState.errors.email]} />
          </Field>
          <Button type="submit" variant="outline" className="w-full" disabled={sending || googleLoading}>
            {sending && <Spinner />}
            Email me a sign-in link
          </Button>
        </FieldGroup>
      </form>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.23 1.45-1.66 4.25-5.35 4.25-3.22 0-5.85-2.67-5.85-5.96S8.78 6.41 12 6.41c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.67 3.86 14.55 2.9 12 2.9 6.98 2.9 2.9 6.98 2.9 12s4.08 9.1 9.1 9.1c5.25 0 8.74-3.69 8.74-8.89 0-.6-.07-1.06-.15-1.51z" />
    </svg>
  );
}
