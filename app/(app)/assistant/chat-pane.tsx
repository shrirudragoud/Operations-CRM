"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Chat } from "@/components/assistant/chat";
import type { Thread } from "@/lib/ai/types";

/** The full-page chat. A new chat moves to its own address once it has its first answer, without restarting a voice call. */
export function ChatPane({ thread }: { thread: Thread | null }) {
  const router = useRouter();
  const id = thread?.id ?? null;
  const [prev, setPrev] = useState(id);
  const [created, setCreated] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  if (id !== prev) {
    setPrev(id);
    if (id !== created) setVersion((v) => v + 1);
    setCreated(null);
  }
  return (
    <Chat
      key={version}
      initial={thread}
      onCreated={(newId) => {
        setCreated(newId);
        router.replace(`/assistant?c=${newId}`, { scroll: false });
      }}
      className="mx-auto min-h-0 w-full max-w-3xl flex-1"
    />
  );
}
