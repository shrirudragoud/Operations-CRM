import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";

export const metadata: Metadata = { title: "Institutions" };

export default function Page() {
  return <WorkspacePlaceholder area="institutions" summary="Institution list with filters, CSV import and the Institution 360 page." />;
}
