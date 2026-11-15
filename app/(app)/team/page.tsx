import type { Metadata } from "next";
import { MailIcon, UsersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccessDenied } from "@/components/access-denied";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { requireArea } from "@/lib/auth";
import { formatDate, isPast } from "@/lib/format";
import { DEPARTMENT_LABELS, ROLE_LABELS, type Department, type Role } from "@/lib/permissions";
import { createClient } from "@/utils/supabase/server";
import { InviteActions } from "./invite-actions";
import { InviteDialog } from "./invite-dialog";
import { StaffActions } from "./staff-actions";

export const metadata: Metadata = { title: "Team" };

// A team list is small; cap it anyway so the query is never unbounded.
const MAX_ROWS = 500;

function Departments({ role, departments }: { role: Role; departments: Department[] }) {
  if (role === "founder") return <span className="text-muted-foreground text-sm">All</span>;
  if (role === "partner") return <span className="text-muted-foreground text-sm">Own records only</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {departments.map((d) => (
        <Badge key={d} variant="outline">{DEPARTMENT_LABELS[d]}</Badge>
      ))}
    </div>
  );
}

export default async function TeamPage() {
  const { me, allowed } = await requireArea("team");
  const header = (
    <PageHeader
      title="Team"
      description="Who can sign in, their role and departments. Access is invite-only."
      actions={allowed ? <InviteDialog /> : undefined}
    />
  );
  if (!allowed) return <>{header}<AccessDenied what="team admin" /></>;

  const supabase = await createClient();
  const [staffRes, inviteRes] = await Promise.all([
    supabase
      .from("staff")
      .select("id, full_name, email, role, departments, is_active, created_at")
      .order("is_active", { ascending: false })
      .order("full_name")
      .range(0, MAX_ROWS - 1),
    supabase
      .from("invite")
      .select("id, email, full_name, role, departments, created_at, expires_at")
      .is("accepted_at", null)
      .order("created_at", { ascending: false })
      .range(0, MAX_ROWS - 1),
  ]);
  return (
    <>
      {header}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>Deactivated people lose access immediately; their history stays.</CardDescription>
          </CardHeader>
          <CardContent>
            {staffRes.error ? (
              <LoadError what="the team" />
            ) : !staffRes.data.length ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><UsersIcon aria-hidden /></EmptyMedia>
                  <EmptyTitle>No team members yet</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden md:table-cell">Departments</TableHead>
                    <TableHead className="hidden sm:table-cell">Status</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staffRes.data.map((s) => (
                    <TableRow key={s.id} className={s.is_active ? undefined : "text-muted-foreground"}>
                      <TableCell>
                        <div className="font-medium">
                          {s.full_name}
                          {s.id === me.id && <span className="text-muted-foreground font-normal"> (you)</span>}
                        </div>
                        <div className="text-muted-foreground text-xs break-all">{s.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.role === "founder" ? "default" : "secondary"}>{ROLE_LABELS[s.role]}</Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Departments role={s.role} departments={s.departments} />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {s.is_active ? <Badge variant="outline">Active</Badge> : <Badge variant="destructive">Deactivated</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <StaffActions staff={s} isSelf={s.id === me.id} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
            <CardDescription>
              An invite is accepted the first time that email signs in. Invites expire after 30 days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {inviteRes.error ? (
              <LoadError what="invites" />
            ) : !inviteRes.data.length ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><MailIcon aria-hidden /></EmptyMedia>
                  <EmptyTitle>No pending invites</EmptyTitle>
                  <EmptyDescription>Use Invite to add a teammate or a distribution partner.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden md:table-cell">Departments</TableHead>
                    <TableHead className="hidden sm:table-cell">Expires</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inviteRes.data.map((inv) => {
                    const expired = isPast(inv.expires_at);
                    return (
                      <TableRow key={inv.id}>
                        <TableCell>
                          <div className="font-medium break-all">{inv.email}</div>
                          {inv.full_name && <div className="text-muted-foreground text-xs">{inv.full_name}</div>}
                        </TableCell>
                        <TableCell><Badge variant="secondary">{ROLE_LABELS[inv.role]}</Badge></TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Departments role={inv.role} departments={inv.departments} />
                        </TableCell>
                        <TableCell className="hidden sm:table-cell whitespace-nowrap">
                          {expired ? <Badge variant="destructive">Expired</Badge> : formatDate(inv.expires_at)}
                        </TableCell>
                        <TableCell>
                          <InviteActions inviteId={inv.id} email={inv.email} expired={expired} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
