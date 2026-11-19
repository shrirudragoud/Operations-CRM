import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMe } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { canHaveProfile } from "@/lib/portal";
import { getMyProfile } from "@/lib/queries/profile";
import { EMPLOYMENT_LABELS, EMPLOYMENT_TYPES } from "@/lib/schemas/profile";
import { createClient } from "@/utils/supabase/server";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const me = await requireMe();
  if (!canHaveProfile(me)) {
    return <p className="text-muted-foreground text-sm">A profile is kept for team members. Your role doesn&apos;t have one.</p>;
  }

  const supabase = await createClient();
  const { data: p, error } = await getMyProfile(supabase, me.id);
  if (error || !p) return <LoadError what="your profile" />;

  let managerName: string | null = null;
  if (p.manager_id) {
    const { data: m } = await supabase.from("staff").select("full_name").eq("id", p.manager_id).maybeSingle();
    managerName = m?.full_name ?? null;
  }
  const employmentType = EMPLOYMENT_TYPES.find((t) => t === p.employment_type);

  const locked: { label: string; value: string }[] = [
    { label: "Employee code", value: p.employee_code ?? "Not set yet" },
    { label: "Designation", value: p.designation ?? "Not set yet" },
    { label: "Joined on", value: p.joined_on ? formatDate(p.joined_on) : "Not set yet" },
    { label: "Employment type", value: employmentType ? EMPLOYMENT_LABELS[employmentType] : "Not set yet" },
    { label: "Probation ends", value: p.probation_end ? formatDate(p.probation_end) : "Not set" },
    { label: "Manager", value: managerName ?? "Not set yet" },
  ];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>Only you and HR can see these. Colleagues see your name, work email, work phone, role and designation in the directory.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            defaults={{
              legal_name: p.legal_name ?? "",
              birth_date: p.birth_date ?? "",
              personal_email: p.personal_email ?? "",
              personal_phone: p.personal_phone ?? "",
              address: p.address ?? "",
              emergency_name: p.emergency_name ?? "",
              emergency_phone: p.emergency_phone ?? "",
              emergency_relation: p.emergency_relation ?? "",
              blood_group: p.blood_group ?? "",
              birthday_visible: p.birthday_visible,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Set by HR</CardTitle>
          <CardDescription>You can read these but not change them. Ask HR if something is wrong.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            {locked.map((f) => (
              <div key={f.label}>
                <dt className="text-muted-foreground text-xs">{f.label}</dt>
                <dd className="text-sm">{f.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
