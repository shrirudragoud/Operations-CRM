import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, ClockIcon, LogInIcon, MapPinIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";
import { AccessDenied } from "@/components/access-denied";
import { Chip } from "@/components/chips";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dayStatus, formatClock, istMinutes, networkAlert, summarise, type DayRow, type OfficeSettings } from "@/lib/attendance";
import { requireArea } from "@/lib/auth";
import { formatDate, formatTime, todayIST } from "@/lib/format";
import { canCheckIn, canSeeTeamAttendance, isFounder, isRemote } from "@/lib/permissions";
import {
  getDays, getOfficeSettings, listHolidays, listMarks, listMissing, listNetworks, listRequests, listTagged, recentRefusals,
} from "@/lib/queries/attendance";
import { formatHM, parseWeek, weekDays } from "@/lib/schemas/time";
import { addDays } from "@/lib/task-layout";
import { TONE_TEXT } from "@/lib/tone";
import { createClient } from "@/utils/supabase/server";
import { ClearMarkButton, DecideButtons, ExcuseDialog, FixCheckoutDialog } from "./lead-actions";
import { AskForTimeDialog, RemoteDialog } from "./request-forms";
import { HolidaysPanel, HoursForm, NetworksPanel } from "./settings-forms";

export const metadata: Metadata = { title: "Attendance" };

type Tab = "week" | "request" | "team" | "requests" | "missing" | "settings";
const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric" });
const dayLong = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" });

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ tab?: string; week?: string }> }) {
  const { me, allowed } = await requireArea("attendance");
  const crumbs = [{ label: "Attendance" }];
  if (!allowed) return <><PageHeader title="Attendance" crumbs={crumbs} /><AccessDenied what="attendance" /></>;

  const sp = await searchParams;
  const mine = canCheckIn(me);
  const lead = canSeeTeamAttendance(me);
  const founder = isFounder(me);

  const asked = sp.tab as Tab | undefined;
  const fallback: Tab = mine ? "week" : "team";
  let tab: Tab = asked ?? fallback;
  if (tab === "request") tab = mine ? "request" : fallback;
  if (tab === "week" && !mine) tab = fallback;
  if ((tab === "team" || tab === "requests" || tab === "missing") && !lead) tab = fallback;
  if (tab === "settings" && !founder) tab = fallback;
  if (!["week", "request", "team", "requests", "missing", "settings"].includes(tab)) tab = fallback;

  const supabase = await createClient();
  const today = todayIST();
  const start = parseWeek(sp.week, today);
  const end = addDays(start, 6);
  const nowMinutes = istMinutes(new Date());

  const settingsRes = await getOfficeSettings(supabase);
  const header = <PageHeader title="Attendance" crumbs={crumbs} description="Who is in, and when. Times are in India time." />;
  if (settingsRes.error || !settingsRes.data) return <>{header}<LoadError what="attendance" /></>;
  const settings = settingsRes.data;

  const [pendingRes, missingRes, refusals] = await Promise.all([
    lead ? listRequests(supabase, "pending") : Promise.resolve(null),
    lead ? listMissing(supabase) : Promise.resolve(null),
    founder ? recentRefusals(supabase) : Promise.resolve(null),
  ]);
  const decidable = (pendingRes?.data ?? []).filter((r) => r.staff_id !== me.id);
  const missingCount = missingRes?.data?.length ?? 0;
  const alert = founder && refusals && networkAlert(refusals.byPerson);

  const tabs: { id: Tab; label: string; count?: number }[] = [];
  if (mine) tabs.push({ id: "week", label: "My week" });
  if (lead) tabs.push({ id: "team", label: "Team" }, { id: "requests", label: "Requests", count: decidable.length }, { id: "missing", label: "No check-out", count: missingCount });
  if (founder) tabs.push({ id: "settings", label: "Settings" });

  return (
    <>
      {header}
      {!settings.flags_on && (
        <Alert className="mb-4">
          <ClockIcon aria-hidden />
          <AlertTitle>Trial period</AlertTitle>
          <AlertDescription>Arrival and leaving times are recorded, but nobody is shown as late or absent yet.{founder ? " Turn that on in Settings." : ""}</AlertDescription>
        </Alert>
      )}
      {alert && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangleIcon aria-hidden />
          <AlertTitle>Several people could not check in</AlertTitle>
          <AlertDescription>
            {refusals.byPerson.size} people were refused in the last day. The office address may have changed. Open{" "}
            <Link className="underline" href="/attendance?tab=settings">Settings</Link> on the office Wi-Fi and press Trust this network.
          </AlertDescription>
        </Alert>
      )}
      {tabs.length > 1 && (
        <nav className="mb-6 flex flex-wrap gap-1" aria-label="Attendance sections">
          {tabs.map((t) => {
            const on = t.id === tab || (t.id === "week" && tab === "request");
            return (
              <Button key={t.id} asChild size="sm" variant={on ? "secondary" : "ghost"}>
                <Link href={`/attendance?tab=${t.id}`} aria-current={on ? "page" : undefined}>
                  {t.label}
                  {t.count ? <Badge variant="outline" className="ml-1 tabular-nums">{t.count}</Badge> : null}
                </Link>
              </Button>
            );
          })}
        </nav>
      )}

      {(tab === "week" || tab === "request") && (
        <MyWeek
          meId={me.id} remote={isRemote(me)} tab={tab} settings={settings} today={today} start={start} end={end} nowMinutes={nowMinutes}
        />
      )}
      {tab === "team" && <TeamWeek settings={settings} today={today} start={start} end={end} nowMinutes={nowMinutes} />}
      {tab === "requests" && <RequestsTab meId={me.id} pending={decidable} />}
      {tab === "missing" && <MissingTab rows={missingRes?.data ?? []} />}
      {tab === "settings" && <SettingsTab settings={settings} today={today} />}
    </>
  );
}

// ---------------------------------------------------------------- shared bits

function WeekNav({ tab, start }: { tab: string; start: string }) {
  const href = (week: string | null) => `/attendance?tab=${tab}${week ? `&week=${week}` : ""}`;
  return (
    <nav className="flex gap-2" aria-label="Week">
      <Button asChild variant="outline" size="sm"><Link href={href(addDays(start, -7))}>Previous week</Link></Button>
      <Button asChild variant="outline" size="sm"><Link href={href(null)}>This week</Link></Button>
      <Button asChild variant="outline" size="sm"><Link href={href(addDays(start, 7))}>Next week</Link></Button>
    </nav>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: "green" | "amber" | "red" | "slate" | "blue" | "orange" }) {
  return (
    <Card className="gap-1 px-4 py-3 shadow-none">
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <div className={cn("text-2xl leading-tight font-semibold tabular-nums", TONE_TEXT[tone])}>{value}</div>
    </Card>
  );
}

function Summary({ rows, settings, today, nowMinutes }: { rows: DayRow[]; settings: OfficeSettings; today: string; nowMinutes: number }) {
  const s = summarise(rows, settings, today, nowMinutes);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Stat label="Days in" value={s.present} tone="green" />
      <Stat label="Hours" value={formatHM(s.minutes)} tone="blue" />
      {settings.flags_on ? (
        <>
          <Stat label="Late" value={s.late} tone={s.late ? "amber" : "slate"} />
          <Stat label="Left early" value={s.early} tone={s.early ? "amber" : "slate"} />
          <Stat label="Absent" value={s.absent} tone={s.absent ? "red" : "slate"} />
        </>
      ) : (
        <Stat label="No check-out" value={s.missing} tone={s.missing ? "orange" : "slate"} />
      )}
    </div>
  );
}

function times(r: DayRow) {
  if (!r.first_in) return "";
  return `${formatTime(r.first_in)} to ${r.is_open ? "now" : formatTime(r.last_out)}`;
}

// ---------------------------------------------------------------- my week

type RequestRows = Awaited<ReturnType<typeof listRequests>>["data"];

async function MyWeek({
  meId, remote, tab, settings, today, start, end, nowMinutes,
}: { meId: string; remote: boolean; tab: Tab; settings: OfficeSettings; today: string; start: string; end: string; nowMinutes: number }) {
  const supabase = await createClient();
  const [days, pending, decided] = await Promise.all([getDays(supabase, start, end, meId), listRequests(supabase, "pending"), listRequests(supabase, "decided")]);
  if (days.error) return <LoadError what="your week" />;
  const rows = days.data;
  const myRequests = [...(pending.data ?? []), ...(decided.data ?? [])].filter((r) => r.staff_id === meId).slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Week of {formatDate(start)} to {formatDate(end)}. {remote ? "Working" : "Office"} hours {formatClock(settings.start_time)} to {formatClock(settings.end_time)}.
        </p>
        <WeekNav tab="week" start={start} />
      </div>
      <Summary rows={rows} settings={settings} today={today} nowMinutes={nowMinutes} />
      <Card>
        <CardHeader>
          <CardTitle>Each day</CardTitle>
          <CardDescription>Check in and out from the button at the top of any page.{remote ? "" : " Office check-in works on the office Wi-Fi."}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Times</TableHead>
                <TableHead className="text-right">Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weekDays(start).map((d) => {
                const r = rows.find((x) => x.work_date === d);
                const s = r ? dayStatus(r, settings, today, nowMinutes) : null;
                return (
                  <TableRow key={d} className={d === today ? "bg-muted/40" : undefined}>
                    <TableCell className="whitespace-nowrap">{dayLong.format(new Date(`${d}T00:00:00Z`))}</TableCell>
                    <TableCell>
                      {s && <Chip tone={s.tone}>{s.label}</Chip>}
                      {r?.mark_reason && <span className="text-muted-foreground ml-2 text-xs">{r.mark_reason}</span>}
                      {r?.manual && <span className="text-muted-foreground ml-2 text-xs">added by request</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-sm sm:table-cell">{r ? times(r) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{r && r.minutes > 0 ? formatHM(r.minutes) : ""}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{remote ? "Forgot to check in?" : "Not at the office, or could not check in?"}</CardTitle>
          <CardDescription>Say so and a lead will see it. Nothing here blocks you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <AskForTimeDialog today={today} earliest={addDays(today, -7)} defaultOpen={tab === "request"} start={settings.start_time.slice(0, 5)} end={settings.end_time.slice(0, 5)} />
            <RemoteDialog today={today} />
          </div>
          {myRequests.length > 0 && (
            <ul className="divide-y rounded-md border" aria-label="My requests">
              {myRequests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    {formatDate(r.work_date)}, {r.in_time.slice(0, 5)} to {r.out_time.slice(0, 5)}
                    <span className="text-muted-foreground"> · {r.reason}</span>
                    {r.decision_note && <span className="text-muted-foreground"> · {r.decision_note}</span>}
                  </span>
                  <Chip tone={r.status === "approved" ? "green" : r.status === "rejected" ? "red" : "amber"}>
                    {r.status === "approved" ? "Approved" : r.status === "rejected" ? "Declined" : "Waiting"}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- team week

async function TeamWeek({ settings, today, start, end, nowMinutes }: { settings: OfficeSettings; today: string; start: string; end: string; nowMinutes: number }) {
  const supabase = await createClient();
  const [days, tagged, marks] = await Promise.all([getDays(supabase, start, end), listTagged(supabase), listMarks(supabase, start, end)]);
  if (days.error || tagged.error) return <LoadError what="the team's attendance" />;

  const names = new Map((tagged.data ?? []).map((p) => [p.id, p.full_name]));
  const byPerson = new Map<string, DayRow[]>();
  for (const r of days.data) byPerson.set(r.staff_id, [...(byPerson.get(r.staff_id) ?? []), r]);
  const people = [...byPerson.keys()].map((id) => ({ id, name: names.get(id) ?? "Someone" })).sort((a, b) => a.name.localeCompare(b.name));
  const inNow = people.filter((p) => byPerson.get(p.id)?.some((r) => r.work_date === today && r.is_open));
  const dates = weekDays(start);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">Week of {formatDate(start)} to {formatDate(end)}.</p>
        <div className="flex flex-wrap items-center gap-2">
          <ExcuseDialog people={people} today={today} />
          <WeekNav tab="team" start={start} />
        </div>
      </div>

      {people.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><MapPinIcon aria-hidden /></EmptyMedia>
            <EmptyTitle>Nobody is tracked yet</EmptyTitle>
            <EmptyDescription>
              The founder picks who works from the office on the Team page (Track attendance).
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><LogInIcon aria-hidden className={cn("size-4", TONE_TEXT.blue)} /> In the office now</CardTitle>
            </CardHeader>
            <CardContent>
              {inNow.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nobody is checked in right now.</p>
              ) : (
                <div className="flex flex-wrap gap-2">{inNow.map((p) => <Chip key={p.id} tone="blue">{p.name}</Chip>)}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    {dates.map((d) => <TableHead key={d} className={d === today ? "text-foreground" : undefined}>{dayFmt.format(new Date(`${d}T00:00:00Z`))}</TableHead>)}
                    <TableHead className="text-right">Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {people.map((p) => {
                    const rows = byPerson.get(p.id) ?? [];
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium whitespace-nowrap">{p.name}</TableCell>
                        {dates.map((d) => {
                          const r = rows.find((x) => x.work_date === d);
                          const s = r ? dayStatus(r, settings, today, nowMinutes) : null;
                          return (
                            <TableCell key={d} className="align-top">
                              {r && s && s.kind !== "upcoming" && s.kind !== "off" ? (
                                <div className="space-y-0.5">
                                  <Chip tone={s.tone} title={s.label} className="max-w-32 truncate">{s.label}</Chip>
                                  {r.first_in && <div className="text-muted-foreground text-[11px] whitespace-nowrap">{formatTime(r.first_in)}{r.is_open ? "" : ` - ${formatTime(r.last_out)}`}</div>}
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-xs">{s?.kind === "off" ? "Off" : ""}</span>
                              )}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right tabular-nums">{formatHM(rows.reduce((m, r) => m + r.minutes, 0))}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {(marks.data ?? []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Remote and excused days</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y rounded-md border" aria-label="Remote and excused days">
                  {(marks.data ?? []).map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium">{m.staff?.full_name ?? "Someone"}</span>
                        <span className="text-muted-foreground"> · {formatDate(m.mark_date)} · {m.reason}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Chip tone="violet">{m.kind === "remote" ? "Working remotely" : "Excused"}</Chip>
                        <ClearMarkButton staffId={m.staff_id} date={m.mark_date} />
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- requests and missing check-outs

function RequestsTab({ meId, pending }: { meId: string; pending: NonNullable<RequestRows> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Requests for time</CardTitle>
        <CardDescription>People who could not check in and are asking for the time to be added. Approving adds it as a record marked &ldquo;by request&rdquo;.</CardDescription>
      </CardHeader>
      <CardContent>
        {pending.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><LogInIcon aria-hidden /></EmptyMedia>
              <EmptyTitle>Nothing waiting</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="space-y-3" aria-label="Requests waiting">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <div className="min-w-0 space-y-0.5 text-sm">
                  <div className="font-medium">{r.staff?.full_name ?? "Someone"}</div>
                  <div>{formatDate(r.work_date)}, {r.in_time.slice(0, 5)} to {r.out_time.slice(0, 5)}</div>
                  <div className="text-muted-foreground">{r.reason}</div>
                </div>
                {r.staff_id !== meId && <DecideButtons id={r.id} name={r.staff?.full_name ?? "them"} />}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MissingTab({ rows }: { rows: NonNullable<Awaited<ReturnType<typeof listMissing>>["data"]> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No check-out</CardTitle>
        <CardDescription>Checked in, never checked out. Hours are not guessed: say when they left and the day is counted.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><TriangleAlertIcon aria-hidden /></EmptyMedia>
              <EmptyTitle>Nothing to fix</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="space-y-3" aria-label="Days without a check-out">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{r.staff?.full_name ?? "Someone"}</span>
                  <span className="text-muted-foreground"> · {formatDate(r.work_date)}, in at {formatTime(r.check_in_at)}</span>
                </span>
                <FixCheckoutDialog sessionId={r.id} workDate={r.work_date} name={r.staff?.full_name ?? "them"} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- settings (founder)

async function SettingsTab({ settings, today }: { settings: OfficeSettings & { ip_header: string; ip_hops: number }; today: string }) {
  const supabase = await createClient();
  const [holidays, networks] = await Promise.all([listHolidays(supabase, today), listNetworks(supabase)]);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Office hours</CardTitle>
          <CardDescription>Applies to everyone tagged as working from the office.</CardDescription>
        </CardHeader>
        <CardContent><HoursForm settings={settings} /></CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Office network</CardTitle>
          <CardDescription>People can check in only from these connections. Only an address is kept, never where anyone was.</CardDescription>
        </CardHeader>
        <CardContent>{networks.error ? <LoadError what="the networks" /> : <NetworksPanel networks={networks.data ?? []} />}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Holidays</CardTitle>
          <CardDescription>Nobody is expected, or marked absent, on these days.</CardDescription>
        </CardHeader>
        <CardContent>{holidays.error ? <LoadError what="holidays" /> : <HolidaysPanel holidays={holidays.data ?? []} today={today} />}</CardContent>
      </Card>
    </div>
  );
}
