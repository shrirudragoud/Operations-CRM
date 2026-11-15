import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";

export const metadata: Metadata = { title: "Cockpit" };

export default function Page() {
  return <WorkspacePlaceholder area="cockpit" summary="The fundraising funnel with drill-downs, pipeline value, kit loss and partner scorecards." />;
}
