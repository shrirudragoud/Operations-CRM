/** Where a notification leads. Mirrors ops.notification_link() in the database (used for email and browser pushes). */
export function notificationHref(n: { kind: string; task_id?: string | null; meeting_id?: string | null; request_id?: string | null }): string | null {
  if (n.task_id) return `/tasks/${n.task_id}`;
  if (n.meeting_id) return `/calendar/${n.meeting_id}`;
  if (n.kind === "request_hr_reply") return "/me/requests";
  if (n.kind.startsWith("request_") || n.request_id) return "/hr/requests";
  if (n.kind === "hr_file") return "/me/documents";
  return null;
}
