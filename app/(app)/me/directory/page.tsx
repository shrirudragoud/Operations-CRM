import type { Metadata } from "next";
import Link from "next/link";
import { LoadError } from "@/components/load-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { DEPARTMENT_LABELS, DEPARTMENTS, ROLE_LABELS, type Department, type Role } from "@/lib/permissions";
import { canHaveProfile } from "@/lib/portal";
import { getDirectory, getDirectoryEvents } from "@/lib/queries/profile";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "Directory" };

const LINK = "hover:bg-muted focus-visible:ring-ring/50 inline-flex h-8 items-center rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Person = {
  staff_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  departments: Department[];
  designation: string | null;
  manager_name: string | null;
};
type DirectoryEvent = { staff_id: string; full_name: string; kind: string; day: number; years: number | null };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; dept?: string | string[] }> }) {
  const me = await requireMe();
  if (!canHaveProfile(me)) {
    return <p className="text-muted-foreground text-sm">The directory is for team members. Your role doesn&apos;t have access to it.</p>;
  }

  const params = await searchParams;
  const q = first(params.q).trim().toLowerCase().slice(0, 80);
  const dept = DEPARTMENTS.find((d) => d === first(params.dept));
  const month = Number(todayIST().slice(5, 7));

  const supabase = await createClient();
  const [dir, events] = await Promise.all([getDirectory(supabase), getDirectoryEvents(supabase, month)]);
  if (dir.error) return <LoadError what="the directory" />;

  const people = ((dir.data ?? []) as unknown as Person[]).filter(
    (p) =>
      (!q || p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || (p.designation ?? "").toLowerCase().includes(q)) &&
      (!dept || p.departments.includes(dept)),
  );
  const todays = (events.error ? [] : ((events.data ?? []) as unknown as DirectoryEvent[]));

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Team directory</CardTitle>
          <CardDescription>Names, work email, work phone, role and designation. Nothing personal is shown here.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form method="get" role="search" className="flex flex-wrap items-center gap-2">
            <Input name="q" defaultValue={q} placeholder="Search by name, email or designation" aria-label="Search the directory" className="w-72" autoComplete="off" />
            {dept && <input type="hidden" name="dept" value={dept} />}
            <Button type="submit" variant="outline">Search</Button>
          </form>
          <nav aria-label="Filter by department" className="flex flex-wrap gap-2">
            <Link href={q ? `/me/directory?q=${encodeURIComponent(q)}` : "/me/directory"} className={LINK} aria-current={!dept ? "true" : undefined}>All departments</Link>
            {DEPARTMENTS.map((d) => (
              <Link key={d} href={`/me/directory?${new URLSearchParams({ ...(q ? { q } : {}), dept: d }).toString()}`} className={LINK} aria-current={dept === d ? "true" : undefined}>
                {DEPARTMENT_LABELS[d]}
              </Link>
            ))}
          </nav>
          {!people.length ? (
            <p className="text-muted-foreground text-sm">No one matches. Try a different name or clear the filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Departments</TableHead>
                  <TableHead>Work email</TableHead>
                  <TableHead>Work phone</TableHead>
                  <TableHead>Manager</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((p) => (
                  <TableRow key={p.staff_id}>
                    <TableCell className="font-medium">{p.full_name}<span className="text-muted-foreground block text-xs font-normal">{ROLE_LABELS[p.role]}</span></TableCell>
                    <TableCell>{p.designation ?? "—"}</TableCell>
                    <TableCell>{p.departments.length ? p.departments.map((d) => DEPARTMENT_LABELS[d]).join(", ") : "—"}</TableCell>
                    <TableCell><a href={`mailto:${p.email}`} className="underline-offset-4 hover:underline">{p.email}</a></TableCell>
                    <TableCell>{p.phone ?? "—"}</TableCell>
                    <TableCell>{p.manager_name ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Birthdays and anniversaries in {MONTHS[month - 1]}</CardTitle>
          <CardDescription>A birthday shows only if the person chose to share it. The year is never shown.</CardDescription>
        </CardHeader>
        <CardContent>
          {!todays.length ? (
            <p className="text-muted-foreground text-sm">Nothing to celebrate this month.</p>
          ) : (
            <ul className="grid gap-1.5 text-sm">
              {todays.map((e) => (
                <li key={`${e.staff_id}-${e.kind}`}>
                  <span className="font-medium">{e.day} {MONTHS[month - 1]}</span> · {e.full_name}
                  {e.kind === "birthday" ? " · Birthday" : ` · ${e.years} ${e.years === 1 ? "year" : "years"} with Hard-Code`}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
