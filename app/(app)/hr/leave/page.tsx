import type { Metadata } from "next";
import { AccessDenied } from "@/components/access-denied";
import { ApplyLeaveDialog } from "@/components/leave/apply-dialog";
import { AdjustBalanceDialog, HolidayManager, StartYearButton } from "@/components/leave/hr-tools";
import { AwayCard, StateChip } from "@/components/leave/leave-bits";
import { LeaveTypeDialog } from "@/components/leave/leave-type-dialog";
import { DecideButtons } from "@/components/leave/request-actions";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { Chip } from "@/components/chips";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireMe } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/format";
import { canDecideLeave, daysText, policySummary, rangeText, shiftDate } from "@/lib/leave";
import { DEPARTMENT_LABELS, isHr, type Department } from "@/lib/permissions";
import { getOfficeSettings } from "@/lib/queries/attendance";
import {
  getAway, listLeaveHolidays, listLeavePeople, listLeaveTypes, listPendingRequests, listRecentDecisions, listYearBalances,
} from "@/lib/queries/leave";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "Leave" };

const crumbs = [{ label: "People & HR", href: "/hr" }, { label: "Leave" }];

export default async function HrLeavePage() {
  const me = await requireMe();
  const header = <PageHeader title="Leave" description="Approve leave, and set the leave policy." crumbs={crumbs} />;
  if (!canDecideLeave(me)) return <>{header}<AccessDenied what="leave approvals" /></>;

  const hr = isHr(me);
  const today = todayIST();
  const year = Number(today.slice(0, 4));
  const supabase = await createClient();
  const [pending, decisions, away, types, holidays, people, totals, settings] = await Promise.all([
    listPendingRequests(supabase, me.id),
    listRecentDecisions(supabase, me.id),
    getAway(supabase, today, shiftDate(today, 45)),
    listLeaveTypes(supabase, hr),
    listLeaveHolidays(supabase, shiftDate(today, -30)),
    hr ? listLeavePeople(supabase) : Promise.resolve({ data: [], error: null }),
    hr ? listYearBalances(supabase, year) : Promise.resolve({ data: new Map<string, number>(), error: null }),
    getOfficeSettings(supabase),
  ]);
  if (pending.error || decisions.error || types.error) return <>{header}<LoadError what="leave" /></>;

  const peopleOptions = (people.data ?? []).map((p) => ({ id: p.id, full_name: p.full_name }));
  const holds = new Map<string, number>();
  for (const r of pending.data) {
    if (r.from_date.slice(0, 4) !== String(year)) continue;
    const k = `${r.staff_id}|${r.leave_type_id}`;
    holds.set(k, (holds.get(k) ?? 0) + r.days);
  }
  const kept = types.data.filter((t) => t.has_balance && t.is_active);
  const holidayRows = (holidays.data ?? []).filter((h) => h.holiday_date >= today);

  return (
    <>
      {header}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Waiting for a decision</CardTitle>
            <CardDescription>{hr ? "Everyone's requests." : "Requests from your team."} You cannot decide your own.</CardDescription>
          </CardHeader>
          <CardContent>
            {pending.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing is waiting.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead><span className="sr-only">Decide</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.staff_name}</div>
                        <div className="text-muted-foreground text-xs">{r.staff_departments.map((d) => DEPARTMENT_LABELS[d as Department] ?? d).join(", ")}</div>
                      </TableCell>
                      <TableCell>
                        {rangeText(r.from_date, r.to_date, r.day_part, String(year))}
                        <div className="text-muted-foreground max-w-xs text-xs">{r.reason}</div>
                      </TableCell>
                      <TableCell>{r.type_name}</TableCell>
                      <TableCell>{daysText(r.days)}</TableCell>
                      <TableCell><DecideButtons id={r.id} who={r.staff_name} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent decisions</CardTitle></CardHeader>
          <CardContent>
            {decisions.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing has been decided yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decisions.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.staff_name}</TableCell>
                      <TableCell>{rangeText(r.from_date, r.to_date, r.day_part, String(year))}</TableCell>
                      <TableCell>{r.type_name}</TableCell>
                      <TableCell>
                        <StateChip state={r.state} />
                        {r.decision_note && <div className="text-muted-foreground mt-1 max-w-xs text-xs">{r.decision_note}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(r.decided_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {!away.error && <AwayCard rows={away.data} today={today} description="The next six weeks." />}

        {hr && (
          <>
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">Leave policy</CardTitle>
                  <CardDescription>Which kinds of leave exist, and the rules of each. Changes apply from the next application.</CardDescription>
                </div>
                <LeaveTypeDialog />
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Rules</TableHead>
                      <TableHead><span className="sr-only">Edit</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {types.data.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">
                          {t.name} {!t.is_active && <Chip tone="slate">Not in use</Chip>}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-md text-sm">{policySummary(t)}</TableCell>
                        <TableCell className="text-right"><LeaveTypeDialog type={t} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">Balances for {year}</CardTitle>
                  <CardDescription>Days left for each person, counting what is approved. Days waiting for a decision are shown beside them.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ApplyLeaveDialog
                    types={types.data.filter((t) => t.is_active)}
                    balances={[]}
                    workDays={settings.data?.work_days ?? [1, 2, 3, 4, 5]}
                    holidays={(holidays.data ?? []).map((h) => h.holiday_date)}
                    today={today}
                    people={peopleOptions}
                    label="Record leave for someone"
                  />
                  <AdjustBalanceDialog people={peopleOptions} types={types.data} year={year} />
                  <StartYearButton year={year} />
                </div>
              </CardHeader>
              <CardContent>
                {people.error || totals.error ? (
                  <LoadError what="the balances" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Person</TableHead>
                        {kept.map((t) => <TableHead key={t.id}>{t.name}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(people.data ?? []).map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.full_name}</TableCell>
                          {kept.map((t) => {
                            const k = `${p.id}|${t.id}`;
                            const held = holds.get(k) ?? 0;
                            return (
                              <TableCell key={t.id} className="tabular-nums">
                                {totals.data.get(k) ?? 0}
                                {held > 0 && <span className="text-muted-foreground text-xs"> ({held} waiting)</span>}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Holidays</CardTitle>
                <CardDescription>Days the office is closed. They are not counted inside a leave unless that type counts holidays.</CardDescription>
              </CardHeader>
              <CardContent><HolidayManager holidays={holidayRows} today={today} /></CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
