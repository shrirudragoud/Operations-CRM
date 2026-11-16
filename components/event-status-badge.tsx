import { Badge } from "@/components/ui/badge";
import { EVENT_STATUS_LABELS, type EventStatus } from "@/lib/schemas/event";

const VARIANT: Record<EventStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  scheduled: "secondary",
  in_progress: "default",
  completed: "default",
  cancelled: "destructive",
};

/** The label carries the meaning, not the colour. */
export function EventStatusBadge({ status }: { status: string }) {
  const s = status as EventStatus;
  return <Badge variant={VARIANT[s] ?? "outline"}>{EVENT_STATUS_LABELS[s] ?? status}</Badge>;
}
