import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoginForm } from "./login-form";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link_invalid: "That sign-in link is invalid or has expired. Request a new one.",
  missing_code: "The sign-in did not complete. Please try again.",
  claim_failed: "We couldn't check your access. Please try again.",
  access_denied: "Sign-in was cancelled.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined);

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Hard-Code Ops</CardTitle>
            <CardDescription>Sign in with the account the founder invited.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Couldn&apos;t sign you in</AlertTitle>
                <AlertDescription>{ERRORS[error] ?? "Sign-in failed. Please try again."}</AlertDescription>
              </Alert>
            )}
            <LoginForm next={next} />
          </CardContent>
        </Card>
        <p className="text-muted-foreground text-center text-xs">
          Access is by invitation only. Signing in does not create access by itself.
        </p>
      </div>
    </main>
  );
}
