import { Chip } from "@/components/chips";
import { DEAL_STAGE_LABELS, type DealStage } from "@/lib/schemas/deal";
import { DEAL_STAGE_TONE } from "@/lib/tone";

/** The label carries the meaning; colour is extra. */
export function DealStageBadge({ stage }: { stage: string }) {
  return <Chip tone={DEAL_STAGE_TONE[stage] ?? "slate"}>{DEAL_STAGE_LABELS[stage as DealStage] ?? stage}</Chip>;
}
