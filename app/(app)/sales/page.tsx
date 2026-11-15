import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";

export const metadata: Metadata = { title: "Sales" };

export default function Page() {
  return <WorkspacePlaceholder area="sales" summary="Deal pipeline (kanban), deal detail, lost reasons, forecast and partner scorecards." />;
}
