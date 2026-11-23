import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck2Icon, CircleAlertIcon, ListTodoIcon, ShieldCheckIcon } from "lucide-react";
import { AttendanceToday } from "@/components/attendance-today";
import { Chip } from "@/components/chips";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { canCheckIn, DEPARTMENT_LABELS, ROLE_LABELS, isHr } from "@/lib/permissions";
import { mineOr, ownedTaskIds } from "@/lib/queries/tasks";
import { createClient } from "@/utils/supabase/server";
import { StatCard } from "../my-day-widgets";

export const metadata: Metadata = { title: "My space" };

const OPEN = ["todo", "doing", "blocked"];

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export default async function MeOverviewPage() {
  const me = await requireMe();
  const supabase = await createClient();
  const today = todayIST();
  const owned = await ownedTaskIds(supabase, me.id);
  const mine = () => supabase.from("task").select("id", { count: "exact", head: true }).or(mineOr(me.id, owned)).in("status", OPEN);
  const [open, overdue, dueToday] = await Promise.all([
    mine(),
    mine().lt("due_date", today),
    mine().eq("due_date", today),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div aria-hidden className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-full text-lg font-semibold">
            {initials(me.full_name)}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-lg font-semibold">{me.full_name}</h2>
            <p className="text-muted-foreground text-sm break-all">{me.email}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Chip tone="slate">{ROLE_LABELS[me.role]}</Chip>
              {me.role === "founder" ? <Chip tone="slate">All departments</Chip> : me.departments.map((d) => <Chip key={d} tone="slate">{DEPARTMENT_LABELS[d]}</Chip>)}
              {isHr(me) && <Chip tone="violet" icon={ShieldCheckIcon}>HR</Chip>}
              {canCheckIn(me) && <Chip tone="teal">Checks in at work</Chip>}
            </div>
          </div>
        </CardContent>
      </Card>

      <section aria-label="My work" className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={ListTodoIcon} tone="blue" label="Open tasks" value={open.count ?? 0} hint={<Link className="underline" href="/tasks">See my tasks</Link>} />
        <StatCard icon={CircleAlertIcon} tone={(overdue.count ?? 0) > 0 ? "red" : "slate"} label="Overdue" value={overdue.count ?? 0} />
        <StatCard icon={CalendarCheck2Icon} tone={(dueToday.count ?? 0) > 0 ? "amber" : "slate"} label="Due today" value={dueToday.count ?? 0} />
      </section>

      {canCheckIn(me) && (
        <section aria-label="Today at work" className="max-w-xl">
          <AttendanceToday me={me} />
        </section>
      )}

      {!canCheckIn(me) && (
        <Card className="max-w-xl">
          <CardHeader><CardTitle className="text-base">Attendance</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Attendance is not switched on for you yet. Once the founder turns it on, your month appears here.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
