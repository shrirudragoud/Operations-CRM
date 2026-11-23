"use client";

import { useState } from "react";
import Link from "next/link";
import { MessagesSquareIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { KeyForm } from "@/components/assistant/key-form";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { AssistantStatus, ChatSummary, Thread } from "@/lib/ai/types";
import { ChatList } from "./chat-list";
import { ChatPane } from "./chat-pane";

function SettingsSheet({ status, trigger }: { status: AssistantStatus; trigger: React.ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b pr-14">
          <SheetTitle>Gemini key and model</SheetTitle>
          <SheetDescription>Your own key powers the assistant. Pick the model it uses.</SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto px-4 pb-6">
          <KeyForm status={status} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One panel: chats on the left from large screens (in a drawer below that), the conversation on the right. */
export function AssistantShell({ status, chats, selected, thread, missing }: { status: AssistantStatus; chats: ChatSummary[]; selected: string | null; thread: Thread | null; missing: boolean }) {
  const [drawer, setDrawer] = useState(false);
  const title = chats.find((c) => c.id === selected)?.title;

  return (
    <div className="bg-card flex h-[calc(100dvh-3.5rem-2rem)] min-h-[26rem] overflow-hidden rounded-xl border shadow-xs md:h-[calc(100dvh-3.5rem-3rem)]">
      <aside aria-label="Saved chats" className="bg-muted/30 hidden w-72 shrink-0 flex-col border-r lg:flex">
        <div className="flex h-14 items-center justify-between gap-2 border-b px-3">
          <h2 className="text-sm font-semibold">Chats</h2>
          <Button asChild size="sm">
            <Link href="/assistant" aria-label="New chat">
              <PlusIcon aria-hidden /> New chat
            </Link>
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <ChatList chats={chats} selected={selected} />
        </div>
        <div className="border-t p-2">
          <SettingsSheet
            status={status}
            trigger={
              <Button variant="ghost" className="w-full justify-start" aria-label="Gemini key and model">
                <SettingsIcon aria-hidden /> Key and model
              </Button>
            }
          />
        </div>
      </aside>

      <section aria-label="Chat" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
          <Sheet open={drawer} onOpenChange={setDrawer}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="-ml-1 lg:hidden" aria-label="Chats">
                <MessagesSquareIcon aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-4/5 data-[side=left]:sm:max-w-xs">
              <SheetHeader className="border-b pr-14">
                <SheetTitle>Chats</SheetTitle>
                <SheetDescription>Pick up an earlier conversation.</SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
                <ChatList chats={chats} selected={selected} onPick={() => setDrawer(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <h1 className="mr-auto min-w-0 truncate text-base font-semibold">{title ?? "New chat"}</h1>
          <Button asChild variant="ghost" size="icon" className="lg:hidden">
            <Link href="/assistant" aria-label="New chat">
              <PlusIcon aria-hidden />
            </Link>
          </Button>
          <div className="lg:hidden">
            <SettingsSheet
              status={status}
              trigger={
                <Button variant="ghost" size="icon" aria-label="Gemini key and model">
                  <SettingsIcon aria-hidden />
                </Button>
              }
            />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-3 pt-1 pb-3 sm:px-6 sm:pb-4">
          {missing ? <p className="text-muted-foreground py-6 text-sm">That chat was not found. Start a new one.</p> : <ChatPane thread={thread} />}
        </div>
      </section>
    </div>
  );
}
