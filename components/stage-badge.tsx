import { Chip } from "@/components/chips";
import { STAGE_LABELS, type Stage } from "@/lib/schemas/institution";
import { STAGE_TONE } from "@/lib/tone";

/** Read-only: the stage is moved by activities, deals and events, never edited in a form. The label carries the meaning; colour is extra. */
export function StageBadge({ stage }: { stage: Stage }) {
  return <Chip tone={STAGE_TONE[stage] ?? "slate"}>{STAGE_LABELS[stage]}</Chip>;
}
