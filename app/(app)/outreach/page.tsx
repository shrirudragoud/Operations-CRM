import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { LogActivityButton } from "@/components/log-activity-dialog";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireArea } from "@/lib/auth";
import { canLogActivity } from "@/lib/permissions";
import { OUTREACH_TABS, outreachQuery, parseOutreachParams, type OutreachTab } from "@/lib/schemas/activity";
import { createClient } from "@/utils/supabase/server";
import { FollowUpsTab, HistoryTab, TerritoryTab } from "./tabs";

export const metadata: Metadata = { title: "Outreach" };

const TAB_LABELS: Record<OutreachTab, string> = { followups: "Follow-ups", territory: "Territory", history: "Activity" };

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { me, allowed } = await requireArea("outreach");
  const isPartner = me.role === "partner";
  const header = (
    <PageHeader
      title={isPartner ? "My outreach" : "Outreach"}
      description="Log every visit and call, never miss a follow-up, and see which institutions we haven't touched."
      actions={allowed && canLogActivity(me) ? <LogActivityButton /> : undefined}
    />
  );
  if (!allowed) return <>{header}<AccessDenied what="Outreach" /></>;

  const params = parseOutreachParams(await searchParams);
  const supabase = await createClient();

  return (
    <>
      {header}
      <nav aria-label="Outreach sections" className="mb-4 flex gap-1 border-b">
        {OUTREACH_TABS.map((t) => (
          <Button
            key={t}
            asChild
            variant="ghost"
            size="sm"
            className={`rounded-b-none border-b-2 ${params.tab === t ? "border-primary" : "border-transparent"}`}
          >
            <Link href={`?${outreachQuery({ tab: t })}`} aria-current={params.tab === t ? "page" : undefined}>
              {TAB_LABELS[t]}
            </Link>
          </Button>
        ))}
      </nav>
      {params.tab === "followups" && <FollowUpsTab supabase={supabase} me={me} params={params} />}
      {params.tab === "territory" && <TerritoryTab supabase={supabase} params={params} />}
      {params.tab === "history" && <HistoryTab supabase={supabase} me={me} params={params} />}
    </>
  );
}
