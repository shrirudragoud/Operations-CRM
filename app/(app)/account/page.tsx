import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireMe } from "@/lib/auth";
import { DEPARTMENT_LABELS, ROLE_LABELS } from "@/lib/permissions";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const me = await requireMe();
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
