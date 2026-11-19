"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogInIcon, LogOutIcon, MapPinIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshAttendance } from "@/lib/actions/attendance";
import { dbErrorMessage } from "@/lib/errors";
import { formatTime } from "@/lib/format";
import { createClient } from "@/utils/supabase/client";

// Checking in and out calls the database from the browser with the person's own session: that is the only way the
// database sees their network address. A Server Action would show the app server's address instead (0023).

const NOT_ON_NETWORK = "This device isn't on the office network. Connect to the office Wi-Fi, or ask for the time instead.";

type Result = { ok?: boolean; reason?: string; off_network?: boolean };

/** Check in, or check out while a stretch is open. `since` is the open stretch's start. */
export function CheckButton({ since, size = "sm", className, remote = false }: { since: string | null; size?: "sm" | "default" | "lg"; className?: string; remote?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [needsRequest, setNeedsRequest] = useState(false);
  const open = since !== null;

  function go() {
    setNeedsRequest(false);
    startTransition(async () => {
      const supabase = createClient();
      const { data, error } = await (open ? supabase.rpc("check_out") : supabase.rpc("check_in"));
      if (error) {
        toast.error(dbErrorMessage(error));
        return;
      }
      const r = (data ?? {}) as Result;
      if (r.ok === false && !remote) {
        setNeedsRequest(true);
        toast.error(NOT_ON_NETWORK, { action: { label: "Ask for the time", onClick: () => router.push("/attendance?tab=request") } });
        return;
      }
      if (open) toast.success(r.off_network ? "Checked out. You were away from the office network, so a lead may ask about it." : "Checked out. See you tomorrow.");
      else toast.success("Checked in. Have a good day.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" size={size} variant={open ? "outline" : "default"} className={className} disabled={pending} onClick={go}>
        {open ? <LogOutIcon aria-hidden /> : <LogInIcon aria-hidden />}
        {open ? "Check out" : "Check in"}
      </Button>
      {needsRequest && !remote && (
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => router.push("/attendance?tab=request")}>
          Not at the office? Ask for the time
        </Button>
      )}
    </div>
  );
}

/** The header chip: where I am today, and the one button I need. */
export function AttendanceChip({ since, remote = false }: { since: string | null; remote?: boolean }) {
  return (
    <div className="bg-muted flex items-center gap-2 rounded-full py-0.5 pr-1 pl-3 text-sm" role="status" aria-label={since ? "You are checked in" : "You are not checked in"}>
      <MapPinIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="text-muted-foreground hidden text-xs sm:inline">{since ? `In since ${formatTime(since)}` : "Not in"}</span>
      <CheckButton since={since} remote={remote} className="rounded-full" />
    </div>
  );
}

/** Founder only: the connection I am on becomes an office network. Must run here so it sees my own address. */
export function TrustNetworkButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go() {
    startTransition(async () => {
      const { data, error } = await createClient().rpc("trust_this_network", { p_label: label.trim() || "Office" });
      if (error) {
        toast.error(dbErrorMessage(error));
        return;
      }
      const created = ((data ?? {}) as { created?: boolean }).created;
      toast.success(created ? "This connection is now an office network." : "This connection is already an office network.");
      await refreshAttendance();
      router.refresh();
    });
  }

  return (
    <Button type="button" disabled={pending} onClick={go}>
      <MapPinIcon aria-hidden /> Trust this network
    </Button>
  );
}
