import Link from "next/link";
import { MapPinIcon } from "lucide-react";
import { cn } from "cn";
import { CheckButton } from "@/components/attendance-controls";
import { Chip } from "@/components/chips";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dayStatus, formatClock, istMinutes, type OfficeSettings } from "@/lib/attendance";
import { formatTime, todayIST } from "@/lib/format";
import { isRemote, type Me } from "@/lib/permissions";
import { getDays, getMyOpenSession, getOfficeSettings } from "@/lib/queries/attendance";
import { formatHM } from "@/lib/schemas/time";
import { TONE_TEXT } from "@/lib/tone";
import { createClient } from "@/utils/supabase/server";

/** My day: where I stand today and the one button I need. For people tagged as working from the office. */
export async function AttendanceToday({ me }: { me: Me }) {
  const supabase = await createClient();
  const today = todayIST();
  const [settings, open, days] = await Promise.all([getOfficeSettings(supabase), getMyOpenSession(supabase, me.id), getDays(supabase, today, today, me.id)]);
  if (settings.error || !settings.data) return null;

  const s: OfficeSettings = settings.data;
  const row = days.data[0];
  const status = row ? dayStatus(row, s, today, istMinutes(new Date())) : null;
  const since = open.data?.check_in_at ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPinIcon aria-hidden className={cn("size-4", TONE_TEXT.teal)} /> {isRemote(me) ? "At work" : "At the office"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {status && <Chip tone={status.tone}>{status.label}</Chip>}
          {since && <span className="text-muted-foreground text-xs">since {formatTime(since)}</span>}
          {row && row.minutes > 0 && <span className="text-muted-foreground text-xs">{formatHM(row.minutes)} today</span>}
        </div>
        <p className="text-muted-foreground text-xs">
          {isRemote(me) ? "Working hours" : "Office hours"} {formatClock(s.start_time)} to {formatClock(s.end_time)}, with {s.grace_minutes} minutes to arrive.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CheckButton since={since} remote={isRemote(me)} />
          <Link className="text-muted-foreground text-xs underline-offset-4 hover:underline" href="/attendance">My attendance</Link>
        </div>
      </CardContent>
    </Card>
  );
}
