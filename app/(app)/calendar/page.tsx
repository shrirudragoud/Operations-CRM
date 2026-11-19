import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, HourglassIcon, RepeatIcon } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { FilterLinks } from "@/components/filter-links";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireArea } from "@/lib/auth";
import { formatDateTime, todayIST } from "@/lib/format";
import { DEPARTMENTS, DEPARTMENT_LABELS, canScheduleMeeting, type Department } from "@/lib/permissions";
import { listCalendarItems, listMyOpenRequests, listPeople, listWaitingForMe } from "@/lib/queries/calendar";
import {
  CAL_SCOPES, CAL_SCOPE_LABELS, CAL_SHOWS, CAL_SHOW_LABELS, CAL_VIEWS, CAL_VIEW_LABELS, calQuery, overlaps, parseCalParams, rangeTitle, stepDate,
  type CalParams,
} from "@/lib/schemas/calendar";
import { MEETING_KIND_TONE, TONE_CHIP } from "@/lib/tone";
import { createClient } from "@/utils/supabase/server";
import { PersonPicker } from "./person-picker";
import { CalendarBody } from "./views";
import { NewMeetingButton } from "./new-meeting";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { me, allowed } = await requireArea("calendar");
  const crumbs: { label: string; href?: string }[] = [];
  if (!allowed) return <><PageHeader title="Calendar" crumbs={crumbs} /><AccessDenied what="the calendar" /></>;

  const raw = parseCalParams(await searchParams);
  const myDepartments = me.departments as Department[];
  const teamChoices: Department[] = me.role === "founder" || myDepartments.length === 0 ? [...DEPARTMENTS] : myDepartments;
  const params: CalParams = {
    ...raw,
    dept: raw.scope === "team" ? (raw.dept || teamChoices[0] || "") : raw.dept,
    who: raw.scope === "person" ? (raw.who || me.id) : "",
  } as CalParams;
  const today = todayIST();
  const link = (p: Partial<CalParams>) => `?${calQuery({ ...params, ...p })}`;
  const step = (delta: number) => link({ date: stepDate(params.view, params.date, delta) });

  const supabase = await createClient();
  const [{ items, truncated }, waiting, mine, people] = await Promise.all([
    listCalendarItems(supabase, me, params),
    listWaitingForMe(supabase, me),
    listMyOpenRequests(supabase, me),
    listPeople(supabase),
  ]);
  const single = params.scope === "me" || params.scope === "person";
  const clashes = single
    ? overlaps(items.filter((i) => !i.allDay && (i.source === "event" || (i.source === "meeting" && i.status === "scheduled"))))
    : new Set<string>();
  const whoName = params.scope === "person" ? ((people.data ?? []).find((p) => p.id === params.who)?.full_name ?? "this person") : null;
  const people_ = (people.data ?? []).map((p) => ({ id: p.id, full_name: p.full_name, departments: p.departments as string[] }));
  const create = canScheduleMeeting(me)
    ? <NewMeetingButton me={{ id: me.id, role: me.role, departments: myDepartments }} people={people_} today={today} />
    : undefined;
  const actions = (
    <>
      <Button asChild variant="outline"><Link href="/calendar/series"><RepeatIcon aria-hidden /> Fixed meetings</Link></Button>
      {create}
    </>
  );
  const header = (
    <PageHeader
      title="Calendar"
      crumbs={crumbs}
      description="Workshop days, meetings and everything dated that is assigned to someone: tasks and follow-ups, outreach, deals and content. See your own, a person's, a team's or everyone's."
      actions={actions}
    />
  );
  if (people.error) return <>{header}<LoadError what="the calendar" /></>;

  const waitingCount = waiting.requests.length + waiting.invitations.length;
  return (
    <>
      {header}

      {(waitingCount > 0 || (mine.data ?? []).length > 0) && (
        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          {waitingCount > 0 && (
            <Card className="py-3">
              <CardHeader className="px-4 pb-0"><CardTitle className="text-sm">Waiting for your answer ({waitingCount})</CardTitle></CardHeader>
              <CardContent className="px-4">
                <ul className="space-y-1 text-sm" aria-label="Waiting for your answer">
                  {waiting.requests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-2">
                      <HourglassIcon aria-hidden className="text-muted-foreground size-3.5" />
                      <Link href={`/calendar/${r.id}`} className="font-medium underline-offset-4 hover:underline">{r.title}</Link>
                      <span className="text-muted-foreground">request from {r.organizer?.full_name ?? "a teammate"} · {formatDateTime(r.starts_at)}</span>
                    </li>
                  ))}
                  {waiting.invitations.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-2">
                      <span aria-hidden className={`size-2 rounded-full border ${TONE_CHIP[MEETING_KIND_TONE[m.kind] ?? "slate"]}`} />
                      <Link href={`/calendar/${m.id}`} className="font-medium underline-offset-4 hover:underline">{m.title}</Link>
                      <span className="text-muted-foreground">invited by {m.organizer?.full_name ?? "a teammate"} · {formatDateTime(m.starts_at)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {(mine.data ?? []).length > 0 && (
            <Card className="py-3">
              <CardHeader className="px-4 pb-0"><CardTitle className="text-sm">Your requests ({mine.data?.length})</CardTitle></CardHeader>
              <CardContent className="px-4">
                <ul className="space-y-1 text-sm" aria-label="Requests you sent">
                  {(mine.data ?? []).map((r) => (
                    <li key={r.id}>
                      <Link href={`/calendar/${r.id}`} className="font-medium underline-offset-4 hover:underline">{r.title}</Link>
                      <span className="text-muted-foreground"> · waiting for {r.awaiting?.full_name ?? "an answer"} · {formatDateTime(r.starts_at)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
        <FilterLinks label="Whose" current={params.scope} options={CAL_SCOPES.map((s) => ({ value: s, label: CAL_SCOPE_LABELS[s] }))} href={(v) => link({ scope: v, dept: v === "team" ? params.dept : "", who: v === "person" ? params.who || me.id : "" })} />
        {params.scope === "person" && (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground mr-1 text-sm">Person</span>
            <PersonPicker
              current={params.who}
              options={(people.data ?? []).map((p) => ({ id: p.id, label: p.id === me.id ? `${p.full_name} (you)` : p.full_name, href: link({ scope: "person", who: p.id }) }))}
            />
          </div>
        )}
        {params.scope === "team" && (
          <FilterLinks
            label="Team"
            current={params.dept}
            options={teamChoices.map((d) => ({ value: d as CalParams["dept"], label: DEPARTMENT_LABELS[d] }))}
            href={(v) => link({ dept: v })}
          />
        )}
        <FilterLinks label="Show" current={params.show} options={CAL_SHOWS.map((s) => ({ value: s, label: CAL_SHOW_LABELS[s] }))} href={(v) => link({ show: v })} />
        <FilterLinks label="View" current={params.view} options={CAL_VIEWS.map((v) => ({ value: v, label: CAL_VIEW_LABELS[v] }))} href={(v) => link({ view: v })} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold" aria-live="polite">{rangeTitle(params.view, params.date)}</h2>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link href={step(-1)} aria-label="Previous"><ChevronLeftIcon aria-hidden /> Prev</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href={link({ date: today })}>Today</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href={step(1)} aria-label="Next">Next <ChevronRightIcon aria-hidden /></Link></Button>
        </div>
      </div>

      {whoName && <p className="mb-2 text-sm">Showing <span className="font-medium">{whoName}</span>&apos;s calendar: what they are assigned to and the institutions they own.</p>}
      {truncated && <p role="status" className="text-muted-foreground mb-2 text-sm">Too many things for this range, so only the first {500} of some kinds are shown. Narrow it with Show, Team or a shorter view.</p>}

      <CalendarBody
        view={params.view}
        items={items}
        date={params.date}
        today={today}
        clashes={clashes}
        dayHref={(day) => link({ view: "week", date: day })}
      />

      <p className="text-muted-foreground mt-3 text-xs">
        Orange bars are Workshop days (a multi-day workshop is one bar). Meetings are coloured by kind. Outlined chips are dated work: tasks and follow-ups (red when overdue), outreach, deals and content. Dashed with an hourglass is a request still waiting for an answer; a ring means it needs your answer; a circle-alert means two timed things overlap.
        {params.scope !== "me" && " You see a meeting only if you are invited or it is open to your department or the company, and other work only if your access allows it."}
      </p>
    </>
  );
}
