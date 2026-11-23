import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { ActionList } from "@/components/hr/action-list";
import { Overview } from "@/components/hr/overview";
import { SendFileForm } from "@/components/hr/send-file-form";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireArea } from "@/lib/auth";
import { formatDate, formatTime, todayIST } from "@/lib/format";
import { groupOverview, type ActionRow, type OverviewRow } from "@/lib/hr-home";
import { listStaffChoices } from "@/lib/queries/documents";
import { getHrCounts, listHrActions, listHrOverview, listRecentAccess } from "@/lib/queries/hr-home";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "People & HR" };

const crumbs = [{ label: "People & HR" }];

const SECTIONS = [
  { href: "/hr/people", label: "People records" },
  { href: "/hr/leave", label: "Leave" },
  { href: "/hr/documents", label: "Documents" },
  { href: "/hr/requests", label: "Requests" },
  { href: "/hr/onboarding", label: "Joining and leaving" },
];

function Stat({ href, count, label }: { href: string; count: number; label: string }) {
  return (
    <Link href={href} aria-label={`${count} ${label}`} className="hover:bg-muted/50 focus-visible:ring-ring/50 grid gap-1 rounded-lg border p-4 outline-none focus-visible:ring-[3px]">
      <span className={`text-2xl font-semibold tabular-nums ${count > 0 ? "" : "text-muted-foreground"}`}>{count}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </Link>
  );
}

export default async function HrHomePage() {
  const { allowed } = await requireArea("hr");
  const header = (
    <PageHeader title="People & HR" description="What needs HR today, who is where, and a place to send a file." crumbs={crumbs} />
  );
  if (!allowed) return <>{header}<AccessDenied what="People & HR" /></>;

  const supabase = await createClient();
  const [actions, counts, overview, people, access] = await Promise.all([
    listHrActions(supabase), getHrCounts(supabase), listHrOverview(supabase), listStaffChoices(supabase), listRecentAccess(supabase),
  ]);
  const today = todayIST();
  const c = counts.data?.[0];
  const lists = groupOverview((overview.data ?? []) as OverviewRow[]);

  return (
    <>
      {header}
      <nav aria-label="People & HR sections" className="-mt-2 mb-6 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="hover:bg-muted rounded-md border px-3 py-1.5 text-sm font-medium">{s.label}</Link>
        ))}
      </nav>

      <div className="grid gap-6">
        {counts.error || !c ? (
          <LoadError what="the totals" />
        ) : (
          <section aria-label="At a glance" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat href="/hr/leave" count={Number(c.leave_pending)} label="leave to approve" />
            <Stat href="/hr/requests" count={Number(c.requests_waiting)} label="requests waiting" />
            <Stat href="/hr/documents" count={Number(c.docs_to_verify)} label="papers to verify" />
            <Stat href="/hr/documents" count={Number(c.docs_expiring)} label="papers expiring or expired" />
            <Stat href="/hr/onboarding" count={Number(c.onboarding_due)} label="checklist steps due" />
            <Stat href="/hr/people" count={Number(c.on_leave_today)} label={`on leave today, of ${Number(c.headcount)}`} />
          </section>
        )}

        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>Needs action today</CardTitle>
            <CardDescription>Late and soon-due items first, then oldest first. Each one opens where it is handled.</CardDescription>
          </CardHeader>
          <CardContent>
            {actions.error ? <LoadError what="the list" /> : <ActionList rows={(actions.data ?? []) as ActionRow[]} today={today} />}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>People overview</CardTitle>
              <CardDescription>
                {c ? `${Number(c.headcount)} people on the team. ` : ""}Birthdays are only shown for people who chose to share theirs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {overview.error ? <LoadError what="the overview" /> : <Overview lists={lists} today={today} />}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>Send a file to a person</CardTitle>
              <CardDescription>An offer letter, an experience letter, a payslip. It is stored privately and they are told.</CardDescription>
            </CardHeader>
            <CardContent>
              {people.error ? <LoadError what="the people list" /> : <SendFileForm people={people.data ?? []} />}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>Who opened private records</CardTitle>
            <CardDescription>Every time HR opens a person&apos;s private details, or sends them a file, it is written here. The person can see it too.</CardDescription>
          </CardHeader>
          <CardContent>
            {access.error ? (
              <LoadError what="the access log" />
            ) : !access.data?.length ? (
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
                  {access.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(r.at)} {formatTime(r.at)}</TableCell>
                      <TableCell>{r.actor?.full_name ?? "-"}</TableCell>
                      <TableCell>{r.what}</TableCell>
                      <TableCell>{r.target?.full_name ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
