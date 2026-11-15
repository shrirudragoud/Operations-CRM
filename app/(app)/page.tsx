import type { Metadata } from "next";
import Link from "next/link";
import { InboxIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { LoadError } from "@/components/load-error";
import { requireMe } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { DEPARTMENT_LABELS } from "@/lib/permissions";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "My work" };

const PAGE_SIZE = 50;
const PRIORITY: Record<number, string> = { 1: "Urgent", 2: "High", 3: "Normal", 4: "Low" };

export default async function MyWorkPage() {
  const me = await requireMe();
  const supabase = await createClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  const { data: tasks, error, count } = await supabase
    .from("task")
    .select("id, title, department, status, priority, due_date", { count: "exact" })
    .eq("assignee_id", me.id)
    .in("status", ["todo", "doing", "blocked"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: true })
    .range(0, PAGE_SIZE - 1);

  return (
    <>
      <PageHeader title={`Hello, ${me.full_name.split(" ")[0]}`} description="Open tasks assigned to you." />
      <Card>
        <CardHeader>
          <CardTitle>My open tasks</CardTitle>
          <CardDescription>
            {count !== null && count > PAGE_SIZE
              ? `Showing the first ${PAGE_SIZE} of ${count}, soonest due first.`
              : "Soonest due first."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <LoadError what="your tasks" />
          ) : !tasks?.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><InboxIcon aria-hidden /></EmptyMedia>
                <EmptyTitle>Nothing assigned to you</EmptyTitle>
                <EmptyDescription>
                  Follow-ups from your activities and tasks from deals and events will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead className="hidden sm:table-cell">Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Priority</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => {
                  const overdue = t.due_date !== null && t.due_date < today;
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.title}</TableCell>
                      <TableCell className="hidden sm:table-cell">{DEPARTMENT_LABELS[t.department]}</TableCell>
                      <TableCell>
                        <Badge variant={t.status === "blocked" ? "destructive" : "secondary"}>{t.status}</Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{PRIORITY[t.priority] ?? t.priority}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {formatDate(t.due_date)}
                        {overdue && <Badge variant="destructive" className="ml-2">Overdue</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-muted-foreground mt-4 text-xs">
        Full task management (filters, status changes) arrives with <Link className="underline" href="/tasks">Tasks</Link> in Phase 1.
      </p>
    </>
  );
}
