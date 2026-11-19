"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { runTaskAutomation } from "@/lib/actions/task-collab";

const KEY = "ops_task_auto_at";
const EVERY_MS = 10 * 60 * 1000;

/** On load, asks the database to create today's fixed tasks and send reminders (idempotent; this browser runs it at most every 10 minutes). */
export function TaskAutomation() {
  const router = useRouter();
  useEffect(() => {
    try {
      const last = Number(window.localStorage.getItem(KEY) ?? 0);
      if (Date.now() - last < EVERY_MS) return;
      window.localStorage.setItem(KEY, String(Date.now()));
    } catch {
      return;
    }
    void runTaskAutomation().then((r) => {
      if (r.ok && (r.data.created > 0 || r.data.reminders > 0)) router.refresh();
    });
  }, [router]);
  return null;
}
