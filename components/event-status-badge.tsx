import { Chip } from "@/components/chips";
import { EVENT_STATUS_LABELS, type EventStatus } from "@/lib/schemas/event";
import { EVENT_STATUS_TONE } from "@/lib/tone";

/** The label carries the meaning; colour is extra. */
export function EventStatusBadge({ status }: { status: string }) {
  return <Chip tone={EVENT_STATUS_TONE[status] ?? "slate"}>{EVENT_STATUS_LABELS[status as EventStatus] ?? status}</Chip>;
}
