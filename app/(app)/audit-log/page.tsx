import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  return <WorkspacePlaceholder area="audit_log" summary="Every change to money, stock, stage and access, with who and when." />;
}
