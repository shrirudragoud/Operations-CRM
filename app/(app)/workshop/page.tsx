import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { FilterLinks } from "@/components/filter-links";
import { NewEventButton } from "@/components/new-event-dialog";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireArea } from "@/lib/auth";
import { canManageEvents } from "@/lib/permissions";
import {
  EVENT_KINDS, EVENT_KIND_LABELS, STATUS_FILTERS, STATUS_FILTER_LABELS, WORKSHOP_TABS, WORKSHOP_TAB_LABELS,
  parseWorkshopParams, workshopQuery, type WorkshopParams,
} from "@/lib/schemas/event";
import { CalendarView } from "./calendar";
import { EventsTable } from "./events-table";

export const metadata: Metadata = { title: "Workshop" };

export default async function WorkshopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { me, allowed } = await requireArea("workshop");
  const header = (
    <PageHeader
      title="Workshop"
      description="Schedule workshops with certified trainers, run them from the checklist and close them out."
      actions={allowed && canManageEvents(me) ? <NewEventButton /> : undefined}
    />
  );
  if (!allowed) return <>{header}<AccessDenied what="Workshop" /></>;

  const params = parseWorkshopParams(await searchParams);
  const link = (p: Partial<WorkshopParams>) => `?${workshopQuery({ ...params, ...p, page: p.page ?? 1 })}`;

  return (
    <>
      {header}
      <nav aria-label="Workshop sections" className="mb-4 flex gap-1 border-b">
        {WORKSHOP_TABS.map((t) => (
          <Button
            key={t}
            asChild
            variant="ghost"
            size="sm"
            className={`rounded-b-none border-b-2 ${params.tab === t ? "border-primary" : "border-transparent"}`}
          >
            <Link href={`?${workshopQuery({ ...params, tab: t, page: 1 })}`} aria-current={params.tab === t ? "page" : undefined}>
              {WORKSHOP_TAB_LABELS[t]}
            </Link>
          </Button>
        ))}
      </nav>

      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
        <FilterLinks
          label="Type"
          current={params.kind}
          options={[{ value: "" as const, label: "All" }, ...EVENT_KINDS.map((k) => ({ value: k, label: EVENT_KIND_LABELS[k] }))]}
          href={(v) => link({ kind: v })}
        />
        {params.tab === "events" && (
          <FilterLinks
            label="Status"
            current={params.status}
            options={STATUS_FILTERS.map((s) => ({ value: s, label: STATUS_FILTER_LABELS[s] }))}
            href={(v) => link({ status: v })}
          />
        )}
        <FilterLinks
          label="Trainer"
          current={params.scope}
          options={[{ value: "all" as const, label: "Everyone" }, { value: "mine" as const, label: "My events" }]}
          href={(v) => link({ scope: v })}
        />
      </div>

      {params.tab === "calendar" ? (
        <CalendarView me={me} params={params} link={link} />
      ) : (
        <EventsTable me={me} params={params} link={link} />
      )}
    </>
  );
}
