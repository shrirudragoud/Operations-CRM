import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { FilterLinks } from "@/components/filter-links";
import { NewDealButton } from "@/components/new-deal-dialog";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireArea } from "@/lib/auth";
import { canManageDeals } from "@/lib/permissions";
import {
  DEAL_KINDS, DEAL_KIND_LABELS, SALES_TABS, SALES_TAB_LABELS, parseSalesParams, salesQuery, type SalesParams,
} from "@/lib/schemas/deal";
import { Board } from "./board";
import { PartnerScorecard } from "./partners";
import { Reports } from "./reports";

export const metadata: Metadata = { title: "Sales" };

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { me, allowed } = await requireArea("sales");
  const isPartner = me.role === "partner";
  const header = (
    <PageHeader
      title={isPartner ? "My deals" : "Sales"}
      description="Move every deal from first meeting to won, and see what the pipeline is worth."
      actions={allowed && canManageDeals(me) ? <NewDealButton /> : undefined}
    />
  );
  if (!allowed) return <>{header}<AccessDenied what="Sales" /></>;

  const params = parseSalesParams(await searchParams);
  const tabs = SALES_TABS.filter((t) => t !== "partners" || !isPartner);
  const link = (p: Partial<SalesParams>) => `?${salesQuery({ ...params, ...p })}`;
  const tab = tabs.includes(params.tab) ? params.tab : "pipeline";

  return (
    <>
      {header}
      <nav aria-label="Sales sections" className="mb-4 flex gap-1 border-b">
        {tabs.map((t) => (
          <Button
            key={t}
            asChild
            variant="ghost"
            size="sm"
            className={`rounded-b-none border-b-2 ${tab === t ? "border-primary" : "border-transparent"}`}
          >
            <Link href={`?${salesQuery({ tab: t })}`} aria-current={tab === t ? "page" : undefined}>{SALES_TAB_LABELS[t]}</Link>
          </Button>
        ))}
      </nav>

      {tab === "pipeline" && (
        <>
          <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
            <FilterLinks
              label="Type"
              current={params.kind}
              options={[{ value: "" as const, label: "All" }, ...DEAL_KINDS.map((k) => ({ value: k, label: DEAL_KIND_LABELS[k] }))]}
              href={(v) => link({ kind: v })}
            />
            <FilterLinks
              label="Segment"
              current={params.segment}
              options={[{ value: "" as const, label: "All" }, { value: "school" as const, label: "Schools" }, { value: "college" as const, label: "Colleges" }]}
              href={(v) => link({ segment: v })}
            />
            {!isPartner && (
              <FilterLinks
                label="Owner"
                current={params.scope}
                options={[{ value: "all" as const, label: "Everyone" }, { value: "mine" as const, label: "Mine" }]}
                href={(v) => link({ scope: v })}
              />
            )}
          </div>
          <Board me={me} params={params} />
        </>
      )}
      {tab === "reports" && <Reports />}
      {tab === "partners" && <PartnerScorecard />}
    </>
  );
}
