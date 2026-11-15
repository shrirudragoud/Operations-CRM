import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";

export const metadata: Metadata = { title: "Training" };

export default function Page() {
  return <WorkspacePlaceholder area="training" summary="Trainer roster, programs, teacher enrollments and certification." />;
}
