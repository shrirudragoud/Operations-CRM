import { listNotifications, unreadNotificationCount } from "@/lib/queries/task-collab";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/utils/supabase/server";
import { NotificationBellMenu } from "./notification-bell-menu";

/** Reads my latest notifications (RLS: only mine) and hands them to the client popover. */
export async function NotificationBell({ meId }: { meId: string }) {
  const supabase = await createClient();
  const [count, list] = await Promise.all([unreadNotificationCount(supabase, meId), listNotifications(supabase, meId, 20)]);
  const items = (list.data ?? []).map((n) => ({
    id: n.id,
    kind: n.kind,
    href: n.task_id ? `/tasks/${n.task_id}` : n.meeting_id ? `/calendar/${n.meeting_id}` : n.kind === "hr_file" ? "/me/documents" : n.kind === "request_hr_reply" ? "/me/requests" : n.request_id ? "/hr/requests" : null,
    message: n.message,
    at: formatDateTime(n.created_at),
    read: n.read_at !== null,
    actor: n.actor?.full_name ?? null,
  }));
  return <NotificationBellMenu unread={count} items={items} />;
}
