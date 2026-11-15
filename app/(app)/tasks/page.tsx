import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";

export const metadata: Metadata = { title: "Tasks" };

export default function Page() {
  return <WorkspacePlaceholder area="tasks" summary="All tasks for your departments with filters and status changes." />;
}
