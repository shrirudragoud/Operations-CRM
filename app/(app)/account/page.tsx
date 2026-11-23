import type { Metadata } from "next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireMe } from "@/lib/auth";
import { DEPARTMENT_LABELS, ROLE_LABELS } from "@/lib/permissions";
import { DEFAULT_EMAIL_GROUPS, EMAIL_GROUPS, type EmailGroupId } from "@/lib/schemas/email";
import { createClient } from "@/utils/supabase/server";
import { EmailForm } from "./email-form";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const me = await requireMe();
  const supabase = await createClient();
  const known = new Set<string>(EMAIL_GROUPS.map((g) => g.id));
  const { data: pref } = await supabase.from("email_pref").select("enabled, groups").eq("staff_id", me.id).maybeSingle();
  const initial = {
    enabled: pref?.enabled ?? true,
    groups: (pref?.groups ?? DEFAULT_EMAIL_GROUPS).filter((g): g is EmailGroupId => known.has(g)),
  };
  const { data: health } = me.role === "founder" ? await supabase.rpc("email_health") : { data: null };
  const h = health && typeof health === "object" && !Array.isArray(health) ? (health as Record<string, unknown>) : null;
  const stuckMinutes = h && typeof h.oldest_queued_minutes === "number" ? h.oldest_queued_minutes : 0;
  const failedCount = h && typeof h.failed === "number" ? h.failed : 0;
  const depts = me.role === "founder" ? "All departments" : me.departments.map((d) => DEPARTMENT_LABELS[d]).join(", ") || "None";
  return (
    <>
      <PageHeader title="Account" description="Your sign-in details." />
      <div className="grid max-w-2xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{me.full_name}</CardTitle>
            <CardDescription className="break-all">{me.email}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {ROLE_LABELS[me.role]} · {depts}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Email</CardTitle>
            <CardDescription>Get an email when something needs you, as well as the bell in the app. Several updates close together arrive as one email.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <EmailForm email={me.email} initial={initial} />
            {h && (stuckMinutes > 10 || failedCount > 0) && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>{stuckMinutes > 10 ? "Email is not going out" : "Some email failed to send"}</AlertTitle>
                <AlertDescription>
                  {stuckMinutes > 10
                    ? `The oldest message has been waiting ${stuckMinutes} minutes. Check that the send-emails timer is running on the server (systemctl --user status send-emails.timer).`
                    : `${failedCount} message${failedCount === 1 ? "" : "s"} could not be sent in the last 7 days.`}
                  {typeof h.last_error === "string" && h.last_error ? ` Last error: ${h.last_error}` : ""}
                </AlertDescription>
              </Alert>
            )}
            {h && (
              <p className="text-muted-foreground border-t pt-3 text-xs">
                Mail queue: {String(h.queued)} waiting, {String(h.failed)} failed in the last 7 days, {String(h.sent_24h)} sent in the last 24 hours
                {typeof h.last_error === "string" && h.last_error ? `. Last error: ${h.last_error}` : ""}.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>Set or change the password you use to sign in. At least 10 characters.</CardDescription>
          </CardHeader>
          <CardContent>
            <PasswordForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
