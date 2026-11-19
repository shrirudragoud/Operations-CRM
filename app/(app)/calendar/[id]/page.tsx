import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CalendarClockIcon, CircleAlertIcon, HourglassIcon, MapPinIcon, RepeatIcon } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Chip, DepartmentChip } from "@/components/chips";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireArea } from "@/lib/auth";
import { formatDate, initials } from "@/lib/format";
import { canAnswerRequest, canEditMeeting, canRsvp, type Department } from "@/lib/permissions";
import { getMeeting, listBusy, listPeople } from "@/lib/queries/calendar";
import {
  MEETING_KIND_LABELS, MEETING_STATUS_LABELS, RSVP_LABELS, VISIBILITY_LABELS, formatLength, formatTimeRange, minutesBetween, seriesSummary,
  type Frequency, type MeetingKind, type MeetingStatus, type Rsvp, type Visibility,
} from "@/lib/schemas/calendar";
import { isoToIstLocal, istDay } from "@/lib/schemas/event";
import { MEETING_KIND_TONE, RSVP_TONE } from "@/lib/tone";
import { createClient } from "@/utils/supabase/server";
import { CancelMeeting, EditMeeting, InviteMore, RemoveAttendee, RequestAnswer, RsvpButtons } from "./actions";

export const metadata: Metadata = { title: "Meeting" };

const STATUS_TONE = { requested: "amber", scheduled: "blue", cancelled: "red", declined: "red" } as const;

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { me, allowed } = await requireArea("calendar");
  const crumbs = [{ label: "Calendar", href: "/calendar" }, { label: "Meeting" }];
  if (!allowed) return <><PageHeader title="Meeting" crumbs={crumbs} /><AccessDenied what="the calendar" /></>;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: m, error } = await getMeeting(supabase, id);
  if (error) return <><PageHeader title="Meeting" crumbs={crumbs} /><LoadError what="this meeting" /></>;
  // RLS hides meetings a person may not see, so "not found" covers "not yours" too.
  if (!m) notFound();

  const status = m.status as MeetingStatus;
  const kind = m.kind as MeetingKind;
  const ref = { organizer_id: m.organizer_id, department: m.department as Department | null, status: m.status, host_id: m.host_id, awaiting_id: m.awaiting_id, ends_at: m.ends_at };
  const manage = canEditMeeting(me, ref);
  const mine = m.attendees.find((a) => a.staff_id === me.id);
  const answerRsvp = mine && canRsvp(me, ref, me.id);
  const answerRequest = canAnswerRequest(me, ref);
  const open = status === "scheduled" || status === "requested";
  const minutes = minutesBetween(m.starts_at, m.ends_at);
  const day = istDay(m.starts_at);

  const [busy, people] = await Promise.all([
    open && mine ? listBusy(supabase, [me.id], m.starts_at, m.ends_at, m.id) : Promise.resolve([]),
    manage ? listPeople(supabase) : Promise.resolve(null),
  ]);
  const invited = new Set(m.attendees.map((a) => a.staff_id));
  const invitable = (people?.data ?? []).filter((p) => !invited.has(p.id)).map((p) => ({ id: p.id, full_name: p.full_name }));
  const local = isoToIstLocal(m.starts_at);
  const localEnd = isoToIstLocal(m.ends_at);

  const counts = { accepted: 0, tentative: 0, declined: 0, invited: 0 };
  for (const a of m.attendees) counts[a.rsvp as Rsvp] += 1;

  const actions = manage ? (
    <>
      <EditMeeting
        series={m.series_id !== null}
        me={{ role: me.role, departments: me.departments as Department[] }}
        initial={{
          id: m.id, title: m.title, description: m.description ?? "", location: m.location ?? "", kind, visibility: m.visibility as Visibility,
          department: (m.department ?? "") as "" | Department, date: local.slice(0, 10), start_time: local.slice(11, 16), end_time: localEnd.slice(11, 16), institution_id: m.institution_id ?? "",
        }}
      />
      <CancelMeeting meetingId={m.id} title={m.title} request={status === "requested"} />
    </>
  ) : undefined;

  return (
    <>
      <PageHeader title={m.title} crumbs={crumbs} actions={actions} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Chip tone={STATUS_TONE[status] ?? "slate"} icon={status === "requested" ? HourglassIcon : undefined}>{MEETING_STATUS_LABELS[status] ?? m.status}</Chip>
        <Chip tone={MEETING_KIND_TONE[kind] ?? "slate"}>{MEETING_KIND_LABELS[kind] ?? m.kind}</Chip>
        {m.department && <DepartmentChip department={m.department} />}
        {m.series_id && <Chip tone="slate" icon={RepeatIcon}>Fixed meeting</Chip>}
        <span className="text-muted-foreground text-xs">{VISIBILITY_LABELS[m.visibility as Visibility]}</span>
      </div>

      {status === "cancelled" || status === "declined" ? (
        <Alert variant="destructive" className="mb-4">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>{status === "cancelled" ? "This meeting was cancelled" : "This request was declined"}</AlertTitle>
          {m.cancel_reason && <AlertDescription>{m.cancel_reason}</AlertDescription>}
        </Alert>
      ) : null}

      {busy.length > 0 && (
        <Alert className="mb-4" role="status">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>You are already booked at this time</AlertTitle>
          <AlertDescription>
            {busy.slice(0, 3).map((b) => `${b.kind === "workshop" ? "Workshop" : "Meeting"} ${formatTimeRange(b.starts_at, b.ends_at)}`).join(" · ")}. You can still go to both.
          </AlertDescription>
        </Alert>
      )}

      {(answerRequest || answerRsvp || (status === "requested" && m.organizer_id === me.id)) && (
        <Card className="mb-4 py-4">
          <CardContent className="space-y-2">
            {answerRequest && (
              <>
                <p className="text-sm font-medium">{m.organizer?.full_name ?? "A teammate"} would like to meet. Will you?</p>
                <RequestAnswer meetingId={m.id} date={local.slice(0, 10)} start={local.slice(11, 16)} end={localEnd.slice(11, 16)} />
              </>
            )}
            {answerRsvp && (
              <>
                <p className="text-sm font-medium">{mine.rsvp === "invited" ? (m.series_id ? "Will you come to this fixed meeting?" : "Will you come?") : `You answered: ${RSVP_LABELS[mine.rsvp as Rsvp]}`}</p>
                <RsvpButtons meetingId={m.id} current={mine.rsvp as Rsvp} seriesId={m.series_id} />
              </>
            )}
            {status === "requested" && m.organizer_id === me.id && !answerRequest && (
              <p className="text-muted-foreground text-sm">Waiting for {m.awaiting?.full_name ?? "an answer"}. They can accept, decline, or suggest another time.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="flex items-start gap-2">
              <CalendarClockIcon aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <span>
                {formatDate(day)}, {formatTimeRange(m.starts_at, m.ends_at)} <span className="text-muted-foreground">({formatLength(minutes)}, India time)</span>
              </span>
            </p>
            {m.location && (
              <p className="flex items-start gap-2"><MapPinIcon aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" /><span>{m.location}</span></p>
            )}
            <p><span className="text-muted-foreground">Organizer:</span> {m.organizer?.full_name ?? "Unknown"}</p>
            {m.host && <p><span className="text-muted-foreground">Asked:</span> {m.host.full_name}</p>}
            {m.institution && (
              <p><span className="text-muted-foreground">Institution:</span> <Link className="underline underline-offset-4" href={`/institutions/${m.institution.id}`}>{m.institution.name}</Link>{m.institution.city ? `, ${m.institution.city}` : ""}</p>
            )}
            {m.event && (
              <p><span className="text-muted-foreground">Workshop:</span> <Link className="underline underline-offset-4" href={`/workshop/${m.event.id}`}>{m.event.title}</Link></p>
            )}
            {m.series && (
              <p>
                <span className="text-muted-foreground">Fixed:</span> {m.series.title}, {seriesSummary({ ...m.series, frequency: m.series.frequency as Frequency })}
                {m.customised && <span className="text-muted-foreground"> (this one was changed)</span>}
                {" "}<Link className="underline underline-offset-4" href="/calendar/series">All fixed meetings</Link>
              </p>
            )}
            {m.description && <p className="whitespace-pre-wrap">{m.description}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">People ({m.attendees.length})</CardTitle>
            {status === "scheduled" && (
              <p className="text-muted-foreground text-xs">{counts.accepted} going · {counts.tentative} maybe · {counts.declined} not going · {counts.invited} waiting</p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2" aria-label="People">
              {m.attendees.map((a) => (
                <li key={a.staff_id} className="flex items-center gap-2 text-sm">
                  <Avatar size="sm"><AvatarFallback className="text-[10px]">{initials(a.staff?.full_name ?? "?")}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1 truncate">
                    {a.staff?.full_name ?? "Former teammate"}
                    {a.staff_id === m.organizer_id && <span className="text-muted-foreground"> · organizer</span>}
                  </span>
                  {status === "scheduled" && <Chip tone={RSVP_TONE[a.rsvp] ?? "slate"}>{RSVP_LABELS[a.rsvp as Rsvp] ?? a.rsvp}</Chip>}
                  {manage && a.staff_id !== m.organizer_id && <RemoveAttendee meetingId={m.id} staffId={a.staff_id} name={a.staff?.full_name ?? "this person"} />}
                </li>
              ))}
            </ul>
            {manage && status === "scheduled" && <InviteMore meetingId={m.id} options={invitable} />}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
