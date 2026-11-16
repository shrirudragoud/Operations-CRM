import { Badge } from "@/components/ui/badge";
import { DEAL_STAGE_LABELS, type DealStage } from "@/lib/schemas/deal";

const VARIANT: Record<DealStage, "default" | "secondary" | "outline" | "destructive"> = {
  meeting: "outline",
  proposal: "secondary",
  negotiation: "secondary",
  won: "default",
  lost: "destructive",
};

/** The label carries the meaning, not the colour. */
export function DealStageBadge({ stage }: { stage: string }) {
  const s = stage as DealStage;
  return <Badge variant={VARIANT[s] ?? "outline"}>{DEAL_STAGE_LABELS[s] ?? stage}</Badge>;
}
