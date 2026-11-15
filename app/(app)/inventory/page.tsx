import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";

export const metadata: Metadata = { title: "Inventory" };

export default function Page() {
  return <WorkspacePlaceholder area="inventory" summary="Items, kits, locations, receiving, reserve/issue/return and low-stock alerts." />;
}
