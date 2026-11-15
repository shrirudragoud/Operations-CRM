import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";

export const metadata: Metadata = { title: "Feedback" };

export default function Page() {
  return <WorkspacePlaceholder area="feedback" summary="Unified feedback inbox routed to the owning department." />;
}
