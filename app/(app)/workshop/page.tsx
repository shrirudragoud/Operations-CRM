import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";

export const metadata: Metadata = { title: "Workshop" };

export default function Page() {
  return <WorkspacePlaceholder area="workshop" summary="Event calendar, scheduling with certified trainers, run sheets and cohort codes." />;
}
