import { ConstructionIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { requireArea } from "@/lib/auth";
import { navItem } from "@/lib/nav";
import type { Area } from "@/lib/permissions";

// Guarded placeholder for workspaces scheduled in later phases (docs/BUILD_PLAN.md).
export async function WorkspacePlaceholder({ area, summary }: { area: Area; summary: string }) {
  const { allowed } = await requireArea(area);
  const item = navItem(area);
  return (
    <>
      <PageHeader title={item.label} />
      {allowed ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ConstructionIcon aria-hidden /></EmptyMedia>
            <EmptyTitle>Coming in Phase {item.phase}</EmptyTitle>
            <EmptyDescription>{summary}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <AccessDenied what={item.label} />
      )}
    </>
  );
}
