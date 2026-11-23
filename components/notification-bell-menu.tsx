"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { clearNotifications, markNotificationsRead } from "@/lib/actions/task-collab";
import { notificationHref } from "@/lib/notification-href";
import { createClient } from "@/utils/supabase/client";

export type NotificationItem = { id: number; kind: string; href: string | null; message: string; at: string; read: boolean; actor: string | null };

// New notifications arrive over a live connection (Supabase Realtime, filtered to me; RLS applies). The slow refresh is only
// a safety net for a dropped connection or a missed event.
const SAFETY_REFRESH_MS = 180_000;
const BURST_MS = 400;

type Incoming = { kind?: string; message?: string; task_id?: string | null; meeting_id?: string | null; request_id?: string | null };

export function NotificationBellMenu({ meId, unread, items }: { meId: string; unread: number; items: NotificationItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, SAFETY_REFRESH_MS);
    return () => clearInterval(t);
  }, [router]);

  useEffect(() => {
    const supabase = createClient();
    let burst: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let closed = false;

    // The socket needs the signed-in person's token before it can see their rows.
    supabase.auth.getSession().then(({ data }) => {
      if (closed) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel(`notifications:${meId}`)
        .on("postgres_changes", { event: "INSERT", schema: "ops", table: "notification", filter: `recipient_id=eq.${meId}` }, (payload) => {
          const n = payload.new as Incoming;
          if (document.visibilityState === "visible" && n.message) {
            const href = notificationHref({ kind: n.kind ?? "", task_id: n.task_id, meeting_id: n.meeting_id, request_id: n.request_id });
            toast(n.message, href ? { action: { label: "Open", onClick: () => router.push(href) } } : undefined);
          }
          clearTimeout(burst);
          burst = setTimeout(() => router.refresh(), BURST_MS);
        })
        .subscribe();
    });

    return () => {
      closed = true;
      clearTimeout(burst);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [meId, router]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}>
          <BellIcon aria-hidden />
          {unread > 0 && (
            <span className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-medium">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          <div className="flex gap-1">
            {unread > 0 && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => startTransition(async () => { await markNotificationsRead({}); })}>
                Mark all read
              </Button>
            )}
            {items.some((i) => i.read) && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => startTransition(async () => { await clearNotifications(); })}>
                Clear read
              </Button>
            )}
          </div>
        </div>
        {items.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">Nothing yet. You are told when a task is assigned to you or changes, you are mentioned, or someone invites you to a meeting.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto" aria-label="Notifications">
            {items.map((n) => {
              const body = (
                <>
                  <span className={`text-sm ${n.read ? "text-muted-foreground" : "font-medium"}`}>{n.message}</span>
                  <span className="text-muted-foreground block text-xs">{n.at}</span>
                </>
              );
              return (
                <li key={n.id} className="px-3 py-2">
                  {n.href ? (
                    <Link
                      href={n.href}
                      className="block hover:underline"
                      onClick={() => { if (!n.read) void markNotificationsRead({ ids: [n.id] }); }}
                    >
                      {body}
                    </Link>
                  ) : body}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
