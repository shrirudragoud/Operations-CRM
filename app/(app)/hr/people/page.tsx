import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireArea } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { DEPARTMENT_LABELS, ROLE_LABELS } from "@/lib/permissions";
import { listPeople } from "@/lib/queries/profile";
import { EMPLOYMENT_LABELS, EMPLOYMENT_TYPES } from "@/lib/schemas/profile";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "People records" };

const crumbs = [{ label: "People & HR", href: "/hr" }, { label: "People records" }];

export default async function HrPeoplePage() {
  const { allowed } = await requireArea("hr");
  const header = <PageHeader title="People records" description="Employee codes, designations, joined dates and managers." crumbs={crumbs} />;
  if (!allowed) return <>{header}<AccessDenied what="People & HR" /></>;

  const { data, error } = await listPeople(await createClient());

  return (
    <>
      {header}
      <Card>
        <CardHeader>
          <CardTitle>Everyone on the team</CardTitle>
          <CardDescription>Open a person to set the HR fields. Opening a full record is written to the access log.</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <LoadError what="the people list" />
          ) : !data?.length ? (
            <p className="text-muted-foreground text-sm">No one is on the team yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Departments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((s) => {
                  const profile = Array.isArray(s.profile) ? s.profile[0] : s.profile;
                  const type = EMPLOYMENT_TYPES.find((t) => t === profile?.employment_type);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        <Link href={`/hr/people/${s.id}`} className="underline-offset-4 hover:underline">{s.full_name}</Link>
                        <span className="text-muted-foreground block text-xs font-normal">{ROLE_LABELS[s.role]}</span>
                      </TableCell>
                      <TableCell>{profile?.employee_code ?? "—"}</TableCell>
                      <TableCell>{profile?.designation ?? "—"}</TableCell>
                      <TableCell>{type ? EMPLOYMENT_LABELS[type] : "—"}</TableCell>
                      <TableCell>{profile?.joined_on ? formatDate(profile.joined_on) : "—"}</TableCell>
                      <TableCell>{s.departments.length ? s.departments.map((d) => DEPARTMENT_LABELS[d]).join(", ") : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
