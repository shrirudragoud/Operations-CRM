import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";

export const metadata: Metadata = { title: "Community" };

export default function Page() {
  return <WorkspacePlaceholder area="community" summary="Content pipeline, featured projects, spotlight stories and growth metrics." />;
}
