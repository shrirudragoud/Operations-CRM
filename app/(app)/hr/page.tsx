import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireArea } from "@/lib/auth";
import { formatDate, formatTime } from "@/lib/format";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "People & HR" };

const crumbs = [{ label: "People & HR" }];

export default async function HrPage() {
  const { allowed } = await requireArea("hr");
  const header = <PageHeader title="People & HR" description="HR tools for the team." crumbs={crumbs} />;
  if (!allowed) return <>{header}<AccessDenied what="People & HR" /></>;

  const { data, error } = await (await createClient())
    .from("hr_access_log")
    .select("id, what, at, actor:staff!hr_access_log_actor_id_fkey(full_name), target:staff!hr_access_log_target_id_fkey(full_name)")
    .order("at", { ascending: false })
    .range(0, 49);

  return (
    <>
      {header}
      <p className="pb-4 text-sm">
        <Link href="/hr/people" className="underline underline-offset-4">People records</Link>
        <span className="text-muted-foreground"> · employee codes, designations, joined dates and managers</span>
      </p>
      <p className="pb-4 text-sm">
        <Link href="/hr/leave" className="underline underline-offset-4">Leave</Link>
        <span className="text-muted-foreground"> · approvals, the leave policy, balances and holidays</span>
      </p>
      <p className="pb-4 text-sm">
        <Link href="/hr/documents" className="underline underline-offset-4">Documents</Link>
        <span className="text-muted-foreground"> · papers to check, expiring papers and the policy library</span>
        {" · "}
        <Link href="/hr/requests" className="underline underline-offset-4">Requests</Link>
        <span className="text-muted-foreground"> · what people have asked HR for</span>
        {" · "}
        <Link href="/hr/onboarding" className="underline underline-offset-4">Joining and leaving</Link>
        <span className="text-muted-foreground"> · checklists</span>
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Who opened private records</CardTitle>
          <CardDescription>Every time HR opens a person&apos;s private details, it is written here. The person can see it too.</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <LoadError what="the access log" />
          ) : !data?.length ? (
            <p className="text-muted-foreground text-sm">No one has opened a private record yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Whose</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.at)} {formatTime(r.at)}</TableCell>
                    <TableCell>{r.actor?.full_name ?? "Unknown"}</TableCell>
                    <TableCell>{r.what}</TableCell>
                    <TableCell>{r.target?.full_name ?? "Unknown"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
