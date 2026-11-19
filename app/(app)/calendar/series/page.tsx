import type { Metadata } from "next";
import { RepeatIcon } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Chip, DepartmentChip } from "@/components/chips";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireArea } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/format";
import { DEPARTMENT_LABELS, canManageSeries, canScheduleMeeting, type Department } from "@/lib/permissions";
import { listPeople, listSeries } from "@/lib/queries/calendar";
import {
  MEETING_KIND_LABELS, VISIBILITY_LABELS, formatLength, seriesSummary, type Frequency, type MeetingKind, type Visibility,
} from "@/lib/schemas/calendar";
import { MEETING_KIND_TONE } from "@/lib/tone";
import { createClient } from "@/utils/supabase/server";
import { NewMeetingButton } from "../new-meeting";
import { SeriesRowActions } from "./row-actions";

export const metadata: Metadata = { title: "Fixed meetings" };

export default async function SeriesPage() {
  const { me, allowed } = await requireArea("calendar");
  const crumbs = [{ label: "Calendar", href: "/calendar" }, { label: "Fixed meetings" }];
  if (!allowed) return <><PageHeader title="Fixed meetings" crumbs={crumbs} /><AccessDenied what="the calendar" /></>;

  const supabase = await createClient();
  const [list, people] = await Promise.all([listSeries(supabase), listPeople(supabase)]);
  const names = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const create = canScheduleMeeting(me) && !people.error
    ? (
      <NewMeetingButton
        me={{ id: me.id, role: me.role, departments: me.departments as Department[] }}
        people={(people.data ?? []).map((p) => ({ id: p.id, full_name: p.full_name, departments: p.departments as string[] }))}
        today={todayIST()}
        label="New meeting"
      />
    )
    : undefined;
  const header = (
    <PageHeader
      title="Fixed meetings"
      crumbs={crumbs}
      description="Meetings that repeat: a weekly team meeting, a fortnightly review, a monthly check-in. The calendar shows the next five weeks and keeps filling in."
      actions={create}
    />
  );
  if (list.error) return <>{header}<LoadError what="fixed meetings" /></>;
  const rows = list.data ?? [];

  if (rows.length === 0) {
    return (
      <>
        {header}
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><RepeatIcon aria-hidden /></EmptyMedia>
            <EmptyTitle>No fixed meetings yet</EmptyTitle>
            <EmptyDescription>Create a meeting and choose how often it repeats. A founder or a department lead can invite the whole department at once.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return (
    <>
      {header}
      <ul className="space-y-3" aria-label="Fixed meetings">
        {rows.map((s) => {
          const manage = canManageSeries(me, s);
          const who = s.all_department && s.department
            ? `Everyone in ${DEPARTMENT_LABELS[s.department]}`
            : s.staff_ids.map((id) => names.get(id) ?? "Former teammate").join(", ");
          return (
            <li key={s.id}>
              <Card>
                <CardContent className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {s.title}
                      <Badge variant={s.active ? "secondary" : "outline"}>{s.active ? "Active" : "Paused"}</Badge>
                      <Chip tone={MEETING_KIND_TONE[s.kind] ?? "slate"}>{MEETING_KIND_LABELS[s.kind as MeetingKind]}</Chip>
                      {s.department && <DepartmentChip department={s.department} />}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {seriesSummary({ ...s, frequency: s.frequency as Frequency })} · {formatLength(s.duration_minutes)}{s.location ? ` · ${s.location}` : ""}
                    </p>
                    <p className="text-muted-foreground text-sm">With: {who || "just the organizer"} (and {s.organizer?.full_name ?? "the organizer"})</p>
                    <p className="text-muted-foreground text-xs">
                      From {formatDate(s.starts_on)}{s.ends_on ? ` to ${formatDate(s.ends_on)}` : ""} · {VISIBILITY_LABELS[s.visibility as Visibility]}
                    </p>
                  </div>
                  {manage && (
                    <div className="flex flex-wrap gap-2">
                      <SeriesRowActions id={s.id} title={s.title} active={s.active} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground mt-4 text-sm">
        To change a fixed meeting&apos;s day or time, delete it and create it again. To change one day only, open that meeting on the calendar and edit it.
      </p>
    </>
  );
}
