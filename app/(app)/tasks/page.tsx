import type { Metadata } from "next";
import Link from "next/link";
import { ListChecksIcon } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/pager";
import { TaskStatusButton } from "@/components/task-status-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireArea } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/format";
import { DEPARTMENT_LABELS, canUpdateTask } from "@/lib/permissions";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/schemas/activity";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "Tasks" };

const PAGE_SIZE = 25;
const PRIORITY: Record<number, string> = { 1: "Urgent", 2: "High", 3: "Normal", 4: "Low" };
const OPEN: TaskStatus[] = ["todo", "doing", "blocked"];

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function entityHref(type: string | null, id: string | null): string | null {
  if (!id) return null;
  if (type === "institution") return `/institutions/${id}`;
  return null;
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<Raw> }) {
  const { me, allowed } = await requireArea("tasks");
  const header = <PageHeader title="Tasks" description="Follow-ups and the tasks that deals and events create for your departments." />;
  if (!allowed) return <>{header}<AccessDenied what="Tasks" /></>;

  const raw = await searchParams;
  const scope = one(raw.scope) === "all" ? "all" : "mine";
  const show = one(raw.show) === "done" ? "done" : "open";
  const page = Math.min(Math.max(Number.parseInt(one(raw.page), 10) || 1, 1), 10_000);
  const qs = (patch: { scope?: string; show?: string; page?: number }) => {
    const p = new URLSearchParams();
    const s = patch.scope ?? scope;
    const sh = patch.show ?? show;
    if (s === "all") p.set("scope", "all");
    if (sh === "done") p.set("show", "done");
    if ((patch.page ?? page) > 1) p.set("page", String(patch.page ?? page));
    const str = p.toString();
    return str ? `?${str}` : "?";
  };

  const supabase = await createClient();
  let query = supabase
    .from("task")
    .select(
      "id, title, department, template, status, priority, due_date, assignee_id, entity_type, entity_id, assignee:staff!task_assignee_id_fkey(full_name)",
      { count: "exact" },
    );
  query = show === "open" ? query.in("status", OPEN) : query.in("status", ["done", "cancelled"]);
  if (scope === "mine") query = query.eq("assignee_id", me.id);
  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query
    .order("due_date", { ascending: show === "open", nullsFirst: false })
    .order("priority", { ascending: true })
    .order("id")
    .range(from, from + PAGE_SIZE - 1);

  const choice = (href: string, active: boolean, label: string) => (
    <Button asChild variant={active ? "secondary" : "ghost"} size="sm">
      <Link href={href} aria-current={active ? "true" : undefined}>{label}</Link>
    </Button>
  );
  const filters = (
    <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
      <div className="flex gap-1" role="group" aria-label="Whose tasks">
        {choice(qs({ scope: "mine", page: 1 }), scope === "mine", "Assigned to me")}
        {choice(qs({ scope: "all", page: 1 }), scope === "all", "My departments")}
      </div>
      <div className="flex gap-1" role="group" aria-label="Status">
        {choice(qs({ show: "open", page: 1 }), show === "open", "Open")}
        {choice(qs({ show: "done", page: 1 }), show === "done", "Done")}
      </div>
    </div>
  );

  if (error) return <>{header}{filters}<LoadError what="tasks" /></>;
  const total = count ?? 0;
  const rows = data ?? [];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total === 0) {
    return (
      <>
        {header}
        {filters}
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ListChecksIcon aria-hidden /></EmptyMedia>
            <EmptyTitle>{show === "open" ? "No open tasks" : "Nothing finished yet"}</EmptyTitle>
            <EmptyDescription>
              {show === "open" ? "Tasks appear when you log a follow-up or when a deal is won." : "Completed and cancelled tasks are listed here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }
  if (rows.length === 0) {
    return (
      <>
        {header}
        {filters}
        <Empty className="border">
          <EmptyHeader><EmptyTitle>That page is past the end</EmptyTitle></EmptyHeader>
          <Button asChild variant="outline"><Link href={qs({ page: 1 })}>Back to page 1</Link></Button>
        </Empty>
      </>
    );
  }

  const today = todayIST();
  return (
    <>
      {header}
      {filters}
      <div className="space-y-4">
        <Table aria-label="Tasks">
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead className="hidden sm:table-cell">Department</TableHead>
              <TableHead className="hidden md:table-cell">Assignee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Priority</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => {
              const href = entityHref(t.entity_type, t.entity_id);
              const overdue = show === "open" && t.due_date !== null && t.due_date < today;
              const canAct = show === "open" && canUpdateTask(me, t);
              return (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    {href ? <Link className="underline-offset-4 hover:underline" href={href}>{t.title}</Link> : t.title}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{DEPARTMENT_LABELS[t.department]}</TableCell>
                  <TableCell className="hidden md:table-cell">{t.assignee?.full_name ?? "Unassigned"}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === "blocked" ? "destructive" : "secondary"}>{TASK_STATUS_LABELS[t.status as TaskStatus] ?? t.status}</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{PRIORITY[t.priority] ?? t.priority}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {formatDate(t.due_date)}
                    {overdue && <Badge variant="destructive" className="ml-2">Overdue</Badge>}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canAct && (
                      <span className="flex justify-end gap-2">
                        {t.status === "todo" && <TaskStatusButton id={t.id} title={t.title} status="doing" label="Start" />}
                        <TaskStatusButton id={t.id} title={t.title} />
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Pager page={page} pages={pages} total={total} noun={["task", "tasks"]} href={(p) => qs({ page: p })} />
      </div>
    </>
  );
}
