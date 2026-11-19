import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireArea } from "@/lib/auth";
import {
  COCKPIT_SEGMENTS, COCKPIT_SEGMENT_LABELS, COCKPIT_VIEWS, COCKPIT_VIEW_LABELS, cockpitQuery, parseCockpitParams, type CockpitParams,
} from "@/lib/cockpit";
import { Fundraising } from "./fundraising";
import { Operations } from "./operations";

export const metadata: Metadata = { title: "Cockpit" };

export default async function CockpitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { me, allowed } = await requireArea("cockpit");
  const header = <PageHeader title="Cockpit" description="How much work is getting done, how early or late, and what needs attention, for today, this week and this month." />;
  if (!allowed) return <>{header}<AccessDenied what="the Cockpit" /></>;

  const raw = await searchParams;
  // Fundraising and the funnel stay with the founder; a department lead gets the Operations view for their team.
  const views = me.role === "founder" ? COCKPIT_VIEWS : (["operations"] as const);
  const params = { ...parseCockpitParams(raw), ...(me.role === "founder" ? {} : { view: "operations" as const }) };
  const link = (p: Partial<CockpitParams>) => {
    const q = cockpitQuery({ ...params, ...p });
    return q ? `?${q}` : "?";
  };

  return (
    <>
      {header}
      <nav aria-label="Cockpit views" className="mb-4 flex gap-1 border-b">
        {views.map((v) => (
          <Button
            key={v}
            asChild
            variant="ghost"
            size="sm"
            className={`rounded-b-none border-b-2 ${params.view === v ? "border-primary" : "border-transparent"}`}
          >
            <Link href={link({ view: v })} aria-current={params.view === v ? "page" : undefined}>{COCKPIT_VIEW_LABELS[v]}</Link>
          </Button>
        ))}
      </nav>
      {params.view === "fundraising" ? (
        <>
          <nav aria-label="Segment" className="mb-4 flex flex-wrap gap-1">
            {COCKPIT_SEGMENTS.map((s) => (
              <Button key={s} asChild variant={params.segment === s ? "secondary" : "ghost"} size="sm">
                <Link href={link({ segment: s })} aria-current={params.segment === s ? "true" : undefined}>{COCKPIT_SEGMENT_LABELS[s]}</Link>
              </Button>
            ))}
          </nav>
          <Fundraising segment={params.segment} />
        </>
      ) : (
        <Operations raw={raw} />
      )}
    </>
  );
}
