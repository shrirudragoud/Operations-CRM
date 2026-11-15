import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";

export const metadata: Metadata = { title: "Outreach" };

export default function Page() {
  return <WorkspacePlaceholder area="outreach" summary="Activity log, follow-up queue, territories and the STEM class calendar." />;
}
