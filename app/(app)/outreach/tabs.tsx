import Link from "next/link";
import { CalendarCheckIcon, MapPinIcon, MessageSquareIcon } from "lucide-react";
import { LoadError } from "@/components/load-error";
import { Pager } from "@/components/pager";
import { StageBadge } from "@/components/stage-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TaskStatusButton } from "@/components/task-status-button";
import { formatDate, formatDateTime, todayIST } from "@/lib/format";
import { canUpdateTask, type Me } from "@/lib/permissions";
import { listActivityHistory, listFollowUps, listTerritory } from "@/lib/queries/outreach";
import {
  COLD_AFTER_DAYS, KIND_LABELS, OUTCOME_LABELS, OUTREACH_PAGE_SIZE, outreachQuery,
  type ActivityKind, type Outcome, type OutreachParams,
} from "@/lib/schemas/activity";
import { STAGES, type Stage } from "@/lib/schemas/institution";
import type { createClient } from "@/utils/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Props = { supabase: Supabase; params: OutreachParams };

const SEGMENT_LABELS = { school: "School", college: "College", other: "Other" } as const;

function Choice({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Button asChild variant={active ? "secondary" : "ghost"} size="sm">
      <Link href={href} aria-current={active ? "true" : undefined}>{children}</Link>
    </Button>
  );
}

function ScopeChoices({ params }: { params: OutreachParams }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Whose records">
      <Choice href={`?${outreachQuery({ ...params, scope: "mine", page: 1 })}`} active={params.scope === "mine"}>Mine</Choice>
      <Choice href={`?${outreachQuery({ ...params, scope: "all", page: 1 })}`} active={params.scope === "all"}>Everyone</Choice>
    </div>
  );
}

// ---------------------------------------------------------------- follow-ups

export async function FollowUpsTab({ supabase, me, params }: Props & { me: Me }) {
  const res = await listFollowUps(supabase, me, params.scope);
  const header = <div className="mb-4"><ScopeChoices params={params} /></div>;
  if (res.error) return <>{header}<LoadError what="follow-ups" /></>;
  if (res.rows.length === 0) {
    return (
      <>
        {header}
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><CalendarCheckIcon aria-hidden /></EmptyMedia>
            <EmptyTitle>No open follow-ups</EmptyTitle>
            <EmptyDescription>
              When you log an activity with a next step and a due date, it shows up here until you mark it done.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  const today = todayIST();
  const groups = [
    { key: "overdue", title: "Overdue", rows: res.rows.filter((t) => t.due_date && t.due_date < today) },
    { key: "today", title: "Due today", rows: res.rows.filter((t) => t.due_date === today) },
    { key: "upcoming", title: "Upcoming", rows: res.rows.filter((t) => !t.due_date || t.due_date > today) },
  ].filter((g) => g.rows.length > 0);

  return (
    <>
      {header}
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.key} aria-labelledby={`fu-${g.key}`}>
            <h2 id={`fu-${g.key}`} className="mb-2 flex items-center gap-2 text-sm font-medium">
              {g.title}
              <Badge variant={g.key === "overdue" ? "destructive" : "secondary"}>{g.rows.length}</Badge>
            </h2>
            <ul className="divide-y rounded-lg border px-4">
              {g.rows.map((t) => {
                const name = t.entity_id ? res.institutions.get(t.entity_id) : undefined;
                return (
                  <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-medium">{t.title}</div>
                      <div className="text-muted-foreground text-sm">
                        {t.entity_id && name ? (
                          <Link className="underline-offset-4 hover:underline" href={`/institutions/${t.entity_id}`}>{name}</Link>
                        ) : (
                          "Institution not visible"
                        )}
                        {" · "}due {formatDate(t.due_date)}
                        {params.scope === "all" && ` · ${t.assignee?.full_name ?? "Unassigned"}`}
                      </div>
                    </div>
                    {canUpdateTask(me, t) && (
                      <TaskStatusButton id={t.id} title={t.title} />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {res.count !== null && res.count > res.rows.length && (
          <p className="text-muted-foreground text-sm">Showing the {res.rows.length} soonest of {res.count} follow-ups.</p>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- territory

export async function TerritoryTab({ supabase, params }: Props) {
  const res = await listTerritory(supabase, params);
  const link = (patch: Partial<OutreachParams>) => `?${outreachQuery({ ...params, ...patch, page: 1 })}`;
  const filters = (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="flex gap-1" role="group" aria-label="Segment">
        <Choice href={link({ segment: "" })} active={params.segment === ""}>All</Choice>
        {(["school", "college"] as const).map((s) => (
          <Choice key={s} href={link({ segment: s })} active={params.segment === s}>{SEGMENT_LABELS[s]}</Choice>
        ))}
      </div>
      <div className="flex gap-1" role="group" aria-label="Last touch">
        <Choice href={link({ touch: "all" })} active={params.touch === "all"}>Any</Choice>
        <Choice href={link({ touch: "untouched" })} active={params.touch === "untouched"}>Untouched</Choice>
        <Choice href={link({ touch: "cold" })} active={params.touch === "cold"}>No touch in {COLD_AFTER_DAYS} days</Choice>
      </div>
      <form method="get" className="flex items-center gap-2" role="search" aria-label="Filter by district">
        <input type="hidden" name="tab" value="territory" />
        {params.segment && <input type="hidden" name="segment" value={params.segment} />}
        {params.touch !== "all" && <input type="hidden" name="touch" value={params.touch} />}
        <label htmlFor="territory-district" className="sr-only">District</label>
        <input
          id="territory-district"
          name="district"
          defaultValue={params.district}
          placeholder="District"
          autoComplete="off"
          className="border-input bg-background h-8 w-40 rounded-md border px-2 text-sm"
        />
        <Button type="submit" variant="outline" size="sm">Filter</Button>
        {params.district && <Button asChild variant="ghost" size="sm"><Link href={link({ district: "" })}>Clear</Link></Button>}
      </form>
    </div>
  );
  if (res.error) return <>{filters}<LoadError what="the territory list" /></>;

  const total = res.count ?? 0;
  const rows = res.data ?? [];
  const pages = Math.max(1, Math.ceil(total / OUTREACH_PAGE_SIZE));
  if (total === 0) {
    return (
      <>
        {filters}
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><MapPinIcon aria-hidden /></EmptyMedia>
            <EmptyTitle>No institutions match</EmptyTitle>
            <EmptyDescription>Change the filters, or add institutions first.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline"><Link href="/institutions">Go to Institutions</Link></Button>
          </EmptyContent>
        </Empty>
      </>
    );
  }
  if (rows.length === 0) {
    return (
      <>
        {filters}
        <Empty className="border">
          <EmptyHeader><EmptyTitle>That page is past the end</EmptyTitle></EmptyHeader>
          <EmptyContent><Button asChild variant="outline"><Link href={link({})}>Back to page 1</Link></Button></EmptyContent>
        </Empty>
      </>
    );
  }
  return (
    <div className="space-y-4">
      {filters}
      <Table aria-label="Territory">
        <TableHeader>
          <TableRow>
            <TableHead>Institution</TableHead>
            <TableHead className="hidden sm:table-cell">District</TableHead>
            <TableHead className="hidden md:table-cell">Segment</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Last touch</TableHead>
            <TableHead className="hidden md:table-cell text-right">Touches</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link className="font-medium underline-offset-4 hover:underline" href={`/institutions/${r.id}`}>{r.name}</Link>
                {r.city && <div className="text-muted-foreground text-xs">{r.city}</div>}
              </TableCell>
              <TableCell className="hidden sm:table-cell">{r.district ?? "-"}</TableCell>
              <TableCell className="hidden md:table-cell">{r.segment ? SEGMENT_LABELS[r.segment as keyof typeof SEGMENT_LABELS] : "-"}</TableCell>
              <TableCell>{(STAGES as readonly string[]).includes(r.stage ?? "") ? <StageBadge stage={r.stage as Stage} /> : "-"}</TableCell>
              <TableCell>{r.last_activity_at ? formatDate(r.last_activity_at) : <Badge variant="outline">Untouched</Badge>}</TableCell>
              <TableCell className="hidden text-right md:table-cell">{r.activities ?? 0}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager
        page={params.page}
        pages={pages}
        total={total}
        noun={["institution", "institutions"]}
        href={(page) => `?${outreachQuery({ ...params, page })}`}
      />
    </div>
  );
}

// ---------------------------------------------------------------- activity history

export async function HistoryTab({ supabase, me, params }: Props & { me: Me }) {
  const res = await listActivityHistory(supabase, me, params);
  const header = <div className="mb-4"><ScopeChoices params={params} /></div>;
  if (res.error) return <>{header}<LoadError what="the activity history" /></>;

  const total = res.count ?? 0;
  const rows = res.data ?? [];
  const pages = Math.max(1, Math.ceil(total / OUTREACH_PAGE_SIZE));
  if (total === 0) {
    return (
      <>
        {header}
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><MessageSquareIcon aria-hidden /></EmptyMedia>
            <EmptyTitle>No activity logged yet</EmptyTitle>
            <EmptyDescription>Use Log activity to record a visit, call, email or WhatsApp message.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }
  if (rows.length === 0) {
    return (
      <>
        {header}
        <Empty className="border">
          <EmptyHeader><EmptyTitle>That page is past the end</EmptyTitle></EmptyHeader>
          <EmptyContent><Button asChild variant="outline"><Link href={`?${outreachQuery({ ...params, page: 1 })}`}>Back to page 1</Link></Button></EmptyContent>
        </Empty>
      </>
    );
  }
  return (
    <div className="space-y-4">
      {header}
      <ul className="divide-y rounded-lg border px-4" aria-label="Activity history">
        {rows.map((a) => (
          <li key={a.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium">
                {KIND_LABELS[a.kind as ActivityKind] ?? a.kind}
                {a.institution && (
                  <>
                    {" at "}
                    <Link className="underline-offset-4 hover:underline" href={`/institutions/${a.institution.id}`}>{a.institution.name}</Link>
                  </>
                )}
                {a.outcome && <Badge variant="secondary" className="ml-2">{OUTCOME_LABELS[a.outcome as Outcome] ?? a.outcome}</Badge>}
              </div>
              {a.notes && <div className="text-muted-foreground line-clamp-2 text-sm">{a.notes}</div>}
              {a.next_step && <div className="text-sm">Next: {a.next_step}{a.next_step_due ? ` (by ${formatDate(a.next_step_due)})` : ""}</div>}
            </div>
            <div className="text-muted-foreground text-xs whitespace-nowrap">
              {formatDateTime(a.happened_at)}{params.scope === "all" && a.author?.full_name ? ` · ${a.author.full_name}` : ""}
            </div>
          </li>
        ))}
      </ul>
      <Pager
        page={params.page}
        pages={pages}
        total={total}
        noun={["activity", "activities"]}
        href={(page) => `?${outreachQuery({ ...params, page })}`}
      />
    </div>
  );
}
