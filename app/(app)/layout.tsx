import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { AppSidebar } from "@/components/app-sidebar";
import { AttendanceChip } from "@/components/attendance-controls";
import { CommandSearch } from "@/components/command-search";
import { NotificationBell } from "@/components/notification-bell";
import { TimerChip } from "@/components/timer-chip";
import { TaskAutomation } from "@/components/task-automation";
import { UserMenu } from "@/components/user-menu";
import { WelcomeToast } from "@/components/welcome-toast";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requireMe } from "@/lib/auth";
import { navFor } from "@/lib/nav";
import { canCheckIn, canTrackTime, isRemote, type Me } from "@/lib/permissions";
import { getMyOpenSession } from "@/lib/queries/attendance";
import { getRunningTimer } from "@/lib/queries/time";
import { finishRequest, PATH_HEADER, RID_HEADER, T0_HEADER, TIMING_ON } from "@/lib/timing";
import { createClient } from "@/utils/supabase/server";

async function RunningTimer({ me }: { me: Me }) {
  if (!canTrackTime(me)) return null;
  const { data } = await getRunningTimer(await createClient(), me.id);
  if (!data) return null;
  return <TimerChip timer={{ id: data.id, taskId: data.task_id, title: data.task?.title ?? "Task", startedAt: data.started_at ?? new Date().toISOString() }} />;
}

async function MyAttendance({ me }: { me: Me }) {
  if (!canCheckIn(me)) return null;
  const { data } = await getMyOpenSession(await createClient(), me.id);
  return <AttendanceChip since={data?.check_in_at ?? null} remote={isRemote(me)} />;
}

// App shell for signed-in staff. ops.me() decides: no active staff row -> /no-access.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireMe();
  const items = navFor(me);
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  if (TIMING_ON) {
    const h = await headers();
    const rid = h.get(RID_HEADER);
    if (rid) {
      const path = h.get(PATH_HEADER) ?? "?";
      const t0 = Number(h.get(T0_HEADER));
      after(() => finishRequest(rid, path, t0));
    }
  }

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <a href="#main" className="bg-background sr-only z-50 rounded p-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <AppSidebar me={me} items={items} />
      <SidebarInset>
        <header className="bg-background/95 sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <div className="flex flex-1 items-center">
            <CommandSearch items={items} />
          </div>
          <Suspense fallback={null}>
            <MyAttendance me={me} />
          </Suspense>
          <Suspense fallback={null}>
            <RunningTimer me={me} />
          </Suspense>
          <Suspense fallback={null}>
            <NotificationBell meId={me.id} />
          </Suspense>
          <UserMenu me={me} />
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
          {children}
        </main>
      </SidebarInset>
      <TaskAutomation />
      <Suspense>
        <WelcomeToast name={me.full_name} />
      </Suspense>
    </SidebarProvider>
  );
}
