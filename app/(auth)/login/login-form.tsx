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

const passwordSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email({ message: "Enter a valid email address." })),
  password: z.string().min(1, "Enter your password."),
});
type PasswordForm = z.input<typeof passwordSchema>;

function callbackUrl(next: string) {
  const url = new URL("/auth/callback", window.location.origin);
  if (next !== "/") url.searchParams.set("next", next);
  return url.toString();
}

export function LoginForm({ next }: { next: string }) {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"password" | "link">("password");
  const form = useForm<EmailForm>({ resolver: zodResolver(emailSchema), defaultValues: { email: "" } });
  const pwForm = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema), defaultValues: { email: "", password: "" } });

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

  async function signInWithPassword(values: PasswordForm) {
    setError(null);
    const parsed = passwordSchema.parse(values);
    const { error } = await createClient().auth.signInWithPassword(parsed);
    if (error) {
      setError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "Email or password is incorrect.",
      );
      return;
    }
    // Same access check as Google/magic link: invite -> staff row, or /no-access.
    // Full navigation on purpose: /auth/claim is a route handler, not a page.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/auth/claim${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`);
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

  const sending = form.formState.isSubmitting || pwForm.formState.isSubmitting;
  const pwErrors = pwForm.formState.errors;
  return (
    <div className="space-y-4">
      <Button type="button" className="w-full" onClick={signInWithGoogle} disabled={googleLoading || sending}>
        {googleLoading ? <Spinner /> : <GoogleIcon />}
        Continue with Google
      </Button>
      <FieldSeparator>or</FieldSeparator>
      {mode === "password" ? (
        <form onSubmit={pwForm.handleSubmit(signInWithPassword)} noValidate>
          <FieldGroup>
            <Field data-invalid={!!pwErrors.email}>
              <FieldLabel htmlFor="pw-email">Email</FieldLabel>
              <Input id="pw-email" type="email" autoComplete="username" inputMode="email"
                aria-invalid={!!pwErrors.email} {...pwForm.register("email")} />
              <FieldError errors={[pwErrors.email]} />
            </Field>
            <Field data-invalid={!!pwErrors.password}>
              <FieldLabel htmlFor="pw-password">Password</FieldLabel>
              <Input id="pw-password" type="password" autoComplete="current-password"
                aria-invalid={!!pwErrors.password} {...pwForm.register("password")} />
              <FieldError errors={[pwErrors.password]} />
            </Field>
            <Button type="submit" variant="outline" className="w-full" disabled={sending || googleLoading}>
              {sending && <Spinner />}
              Sign in with password
            </Button>
          </FieldGroup>
          <Button type="button" variant="link" size="sm" className="mt-2 w-full" onClick={() => setMode("link")}>
            Email me a sign-in link instead
          </Button>
        </form>
      ) : (
        <form onSubmit={form.handleSubmit(sendLink)} noValidate>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.email}>
              <FieldLabel htmlFor="email">Work email</FieldLabel>
              <Input id="email" type="email" autoComplete="email" inputMode="email" placeholder="you@hard-code.in"
                aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
              <FieldError errors={[form.formState.errors.email]} />
            </Field>
            <Button type="submit" variant="outline" className="w-full" disabled={sending || googleLoading}>
              {sending && <Spinner />}
              Email me a sign-in link
            </Button>
          </FieldGroup>
          <Button type="button" variant="link" size="sm" className="mt-2 w-full" onClick={() => setMode("password")}>
            Use a password instead
          </Button>
        </form>
      )}
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
