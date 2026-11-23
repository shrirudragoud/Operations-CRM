"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExpandIcon, KeyRoundIcon, SparklesIcon, SquarePenIcon } from "lucide-react";
import { Chat } from "@/components/assistant/chat";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { assistantStatus } from "@/lib/actions/assistant";
import type { AssistantStatus, Thread } from "@/lib/ai/types";

const TASK_PATH = /^\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** Quick-open assistant on every page. On a task page it knows which task is open. */
export function AssistantPanel() {
  const pathname = usePathname();
  const taskId = TASK_PATH.exec(pathname)?.[1] ?? null;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [thread, setThread] = useState<Thread | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setError(null);
      void assistantStatus().then((r) => (r.ok ? setStatus(r.data) : setError(r.error)));
    }
  }

  const ready = status?.vaultConfigured && status.hasKey;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Open the assistant">
          <SparklesIcon aria-hidden /> <span className="hidden sm:inline">Assistant</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b pr-14">
          <SheetTitle>Assistant</SheetTitle>
          <SheetDescription>{taskId ? "Ask about the task you have open, or anything else." : "Ask about tasks, or have them created."}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : !status ? (
            <div className="space-y-3" role="status" aria-label="Loading">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !ready ? (
            <Empty className="border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRoundIcon aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{status.vaultConfigured ? "Add your Gemini key" : "Not switched on yet"}</EmptyTitle>
                <EmptyDescription>{status.vaultConfigured ? "The assistant uses your own key. It takes a minute to set up." : "The assistant is not switched on for this server yet. Ask the founder."}</EmptyDescription>
              </EmptyHeader>
              {status.vaultConfigured && (
                <EmptyContent>
                  <Button asChild>
                    <Link href="/assistant" onClick={() => setOpen(false)}>Set up the assistant</Link>
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <>
              <div className="flex items-center justify-between pb-1">
                <Button asChild variant="ghost" size="sm" className="-ml-2">
                  <Link href="/assistant" onClick={() => setOpen(false)}>
                    <ExpandIcon aria-hidden /> Open the full assistant
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setThread(null);
                    setRound((n) => n + 1);
                  }}
                >
                  <SquarePenIcon aria-hidden /> New chat
                </Button>
              </div>
              <Chat key={round} initial={thread} onThread={setThread} taskId={taskId} compact className="flex-1" />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
