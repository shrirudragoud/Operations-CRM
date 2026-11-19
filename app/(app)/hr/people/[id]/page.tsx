import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AccessDenied } from "@/components/access-denied";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireArea } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { listManagers, openHrProfile } from "@/lib/queries/profile";
import { createClient } from "@/utils/supabase/server";
import { HrForm } from "./hr-form";

export const metadata: Metadata = { title: "Person record" };

export default async function HrPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { allowed } = await requireArea("hr");
  const crumbs = [{ label: "People & HR", href: "/hr" }, { label: "People records", href: "/hr/people" }, { label: "Record" }];
  if (!allowed) return <><PageHeader title="Person record" crumbs={crumbs} /><AccessDenied what="People & HR" /></>;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [person, profile, managers] = await Promise.all([
    supabase.from("staff").select("id, full_name, email").eq("id", id).maybeSingle(),
    openHrProfile(supabase, id),
    listManagers(supabase),
  ]);
  if (!person.error && !person.data) notFound();
  if (person.error || profile.error || !person.data || !profile.data || managers.error) {
    return <><PageHeader title="Person record" crumbs={crumbs} /><LoadError what="this record" /></>;
  }
  const p = profile.data;
  const personal: { label: string; value: string | null }[] = [
    { label: "Legal name", value: p.legal_name },
    { label: "Date of birth", value: p.birth_date ? formatDate(p.birth_date) : null },
    { label: "Personal email", value: p.personal_email },
    { label: "Personal phone", value: p.personal_phone },
    { label: "Address", value: p.address },
    { label: "Emergency contact", value: p.emergency_name ? `${p.emergency_name}, ${p.emergency_phone}${p.emergency_relation ? ` (${p.emergency_relation})` : ""}` : null },
    { label: "Blood group", value: p.blood_group },
  ];

  return (
    <>
      <PageHeader title={person.data.full_name} description={person.data.email} crumbs={crumbs} />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>HR details</CardTitle>
            <CardDescription>Only HR can change these. The person can read them on their own profile.</CardDescription>
          </CardHeader>
          <CardContent>
            <HrForm
              defaults={{
                staff_id: id,
                employee_code: p.employee_code ?? "",
                designation: p.designation ?? "",
                joined_on: p.joined_on ?? "",
                employment_type: p.employment_type ?? "",
                probation_end: p.probation_end ?? "",
                manager_id: p.manager_id ?? "",
              }}
              managers={(managers.data ?? []).filter((m) => m.id !== id)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
            <CardDescription>The person edits these. You opened this record, and that is written to the access log.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              {personal.map((f) => (
                <div key={f.label}>
                  <dt className="text-muted-foreground text-xs">{f.label}</dt>
                  <dd className="text-sm">{f.value ?? "Not given"}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
