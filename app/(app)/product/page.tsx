import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";

export const metadata: Metadata = { title: "Product" };

export default function Page() {
  return <WorkspacePlaceholder area="product" summary="Replay review queue, insights board, activation funnel, incidents and catalog requests." />;
}
