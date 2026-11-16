import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveIcon, CheckIcon } from "lucide-react";
import { z } from "zod";
import { AccessDenied } from "@/components/access-denied";
import { EventStatusBadge } from "@/components/event-status-badge";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireArea } from "@/lib/auth";
import { formatDate, formatDateTime, formatRange } from "@/lib/format";
import { canAccess, canArchiveEvent, canManageEvents } from "@/lib/permissions";
import { getEvent, listEventTasks } from "@/lib/queries/workshop";
import {
  EVENT_KIND_LABELS, EVENT_STATUS_LABELS, EVENT_STEPS, isoToIstLocal, scheduleMissing, type EventKind, type EventStatus,
} from "@/lib/schemas/event";
import { createClient } from "@/utils/supabase/server";
import { CopyCode } from "./copy-code";
import { EventActions, EventArchiveButton } from "./event-actions";
import { EventDetailsForm } from "./event-details-form";
import { RunSheet } from "./run-sheet";
import { TeamCard } from "./team-card";

export const metadata: Metadata = { title: "Event" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Stepper({ status }: { status: EventStatus }) {
  const current = EVENT_STEPS.indexOf(status as (typeof EVENT_STEPS)[number]);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label="Event progress">
      {EVENT_STEPS.map((s, i) => {
        const done = current > i || status === "completed";
        const active = current === i;
        return (
          <li key={s} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 ${active ? "bg-primary text-primary-foreground border-primary" : done ? "bg-muted" : "text-muted-foreground"}`}>
              {done && <CheckIcon aria-hidden className="size-3" />}
              {EVENT_STATUS_LABELS[s]}
            </span>
            {i < EVENT_STEPS.length - 1 && <span aria-hidden className="text-muted-foreground">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { me, allowed } = await requireArea("workshop");
  const crumbs = [{ label: "Workshop", href: "/workshop" }];
  if (!allowed) {
    return (
      <>
        <PageHeader title="Event" crumbs={crumbs} />
        <AccessDenied what="Workshop" />
      </>
    );
  }
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: ev, error } = await getEvent(supabase, id);
  if (error) {
    return (
      <>
        <PageHeader title="Event" crumbs={crumbs} />
        <LoadError what="this event" />
      </>
    );
  }
  if (!ev) notFound();
  const tasks = await listEventTasks(supabase, id);

  const status = ev.status as EventStatus;
  const archived = ev.archived_at !== null;
  const manage = canManageEvents(me) && !archived;
  const open = status === "draft" || status === "scheduled" || status === "in_progress";
  const editable = manage && open;
  const cohortCode = Array.isArray(ev.cohort) ? ev.cohort[0]?.code : ev.cohort?.code;
  const assistants = ev.team.map((t) => ({ id: t.staff_id, name: t.staff?.full_name ?? "Unknown" }));
  const missing = scheduleMissing(ev);
  const runItems = ev.run_sheet_item.map((r) => ({
    id: r.id, phase: r.phase, label: r.label, done_at: r.done_at, doneBy: r.doneBy?.full_name ?? null,
  }));
  const openTasks = (tasks.data ?? []).filter((t) => t.status !== "done" && t.status !== "cancelled");

  const details = {
    id: ev.id,
    title: ev.title,
    starts_at: isoToIstLocal(ev.starts_at),
    ends_at: isoToIstLocal(ev.ends_at),
    venue: ev.venue ?? "",
    expected_headcount: ev.expected_headcount === null ? "" : String(ev.expected_headcount),
  };

  return (
    <>
      <PageHeader
        title={ev.title}
        crumbs={[...crumbs, { label: ev.title }]}
        description={`${EVENT_KIND_LABELS[ev.kind as EventKind] ?? ev.kind} · ${ev.institution.name}`}
        actions={
          manage && canArchiveEvent(me) && status !== "scheduled" && status !== "in_progress"
            ? <EventArchiveButton id={ev.id} title={ev.title} archived={false} />
            : archived && canArchiveEvent(me)
              ? <EventArchiveButton id={ev.id} title={ev.title} archived />
              : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <EventStatusBadge status={ev.status} />
        {cohortCode && (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Cohort code</span> <CopyCode code={cohortCode} />
          </span>
        )}
        <span className="text-muted-foreground text-sm">{formatRange(ev.starts_at, ev.ends_at)}</span>
      </div>

      {status !== "cancelled" && <div className="mb-4"><Stepper status={status} /></div>}

      {manage && open && (
        <div className="mb-4">
          <EventActions id={ev.id} title={ev.title} status={status} expectedHeadcount={ev.expected_headcount} />
          {status === "draft" && missing.length > 0 && (
            <p className="text-muted-foreground mt-2 text-sm">To schedule, still needed: {missing.join(", ")}.</p>
          )}
        </div>
      )}

      {archived && (
        <Alert className="mb-4">
          <ArchiveIcon aria-hidden />
          <AlertTitle>This event is archived</AlertTitle>
          <AlertDescription>
            Archived on {formatDate(ev.archived_at)}{ev.archiver?.full_name ? ` by ${ev.archiver.full_name}` : ""}. It is hidden from the calendar.
            {canArchiveEvent(me) ? " Use Restore to bring it back." : ""}
          </AlertDescription>
        </Alert>
      )}

      {status === "cancelled" && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Cancelled</AlertTitle>
          <AlertDescription>{ev.cancel_reason ?? "No reason recorded."}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              {editable ? (
                <EventDetailsForm key={ev.updated_at} initial={details} />
              ) : (
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Fact label="When">{formatRange(ev.starts_at, ev.ends_at)}</Fact>
                  <Fact label="Venue">{ev.venue ?? "-"}</Fact>
                  <Fact label="Expected students">{ev.expected_headcount ?? "-"}</Fact>
                  <Fact label="Students who attended">{ev.actual_headcount ?? "-"}</Fact>
                  {ev.satisfaction_score !== null && <Fact label="Satisfaction">{ev.satisfaction_score} / 5</Fact>}
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Run sheet</CardTitle>
              <CardDescription>Tick items off as they are done. The checklist is copied in when the event is scheduled.</CardDescription>
            </CardHeader>
            <CardContent>
              <RunSheet key={runItems.map((r) => `${r.id}${r.done_at ?? ""}`).join()} items={runItems} editable={manage && status !== "draft"} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Trainers</CardTitle>
              <CardDescription>One lead and up to two assistants.</CardDescription>
            </CardHeader>
            <CardContent>
              {editable ? (
                <TeamCard
                  key={`${ev.updated_at}${assistants.map((a) => a.id).join()}`}
                  eventId={ev.id}
                  startLocal={details.starts_at}
                  endLocal={details.ends_at}
                  lead={ev.lead_trainer_id ? { id: ev.lead_trainer_id, name: ev.lead?.full_name ?? "Unknown" } : null}
                  assistants={assistants}
                />
              ) : (
                <dl className="space-y-3">
                  <Fact label="Lead">{ev.lead?.full_name ?? "Not assigned"}</Fact>
                  <Fact label="Assistants">{assistants.length > 0 ? assistants.map((a) => a.name).join(", ") : "None"}</Fact>
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Institution</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Fact label="Name">
                  {canAccess(me, "institutions")
                    ? <Link className="underline" href={`/institutions/${ev.institution.id}`}>{ev.institution.name}</Link>
                    : ev.institution.name}
                </Fact>
                <Fact label="Location">{[ev.institution.city, ev.institution.district].filter(Boolean).join(", ") || "-"}</Fact>
                {ev.deal_id && canAccess(me, "sales") && (
                  <Fact label="Deal"><Link className="underline" href={`/sales/${ev.deal_id}`}>Open the deal</Link></Fact>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Open tasks</CardTitle></CardHeader>
            <CardContent>
              {tasks.error ? (
                <p className="text-muted-foreground text-sm">Could not load tasks.</p>
              ) : openTasks.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nothing open for this event.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {openTasks.map((t) => (
                    <li key={t.id}>
                      <span className="font-medium">{t.title}</span>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline">{t.department}</Badge>
                        {t.assignee?.full_name ?? "Unassigned"}{t.due_date ? ` · due ${formatDate(t.due_date)}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted-foreground mt-3 text-xs">Updated {formatDateTime(ev.updated_at)}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
