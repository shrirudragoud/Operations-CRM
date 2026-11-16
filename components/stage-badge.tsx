import { Badge } from "@/components/ui/badge";
import { STAGE_LABELS, type Stage } from "@/lib/schemas/institution";

const VARIANT: Record<Stage, "default" | "secondary" | "outline" | "destructive"> = {
  prospect: "outline",
  contacted: "outline",
  qualified: "secondary",
  deal_won: "secondary",
  workshop_delivered: "secondary",
  teachers_trained: "secondary",
  active: "default",
  lab_customer: "default",
  renewal: "default",
  churned: "destructive",
};

/** Read-only: the stage is moved by activities, deals and events, never edited in a form. The label carries the meaning, not the colour. */
export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge variant={VARIANT[stage]}>{STAGE_LABELS[stage]}</Badge>;
}
