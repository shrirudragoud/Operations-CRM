import Link from "next/link";
import { MessageSquareIcon } from "lucide-react";
import type { ChatSummary } from "@/lib/ai/types";
import { cn } from "cn";
import { DeleteChatButton } from "./delete-chat-button";

/** The saved chats. `onPick` lets a drawer close itself after a tap. */
export function ChatList({ chats, selected, onPick }: { chats: ChatSummary[]; selected: string | null; onPick?: () => void }) {
  if (chats.length === 0) {
    return <p className="text-muted-foreground px-2 py-4 text-sm">No chats yet. Your conversations are saved here.</p>;
  }
  return (
    <nav aria-label="Chats" className="space-y-0.5">
      {chats.map((c) => (
        <div key={c.id} className={cn("group hover:bg-muted flex items-center rounded-md", c.id === selected && "bg-muted font-medium")}>
          <Link
            href={`/assistant?c=${c.id}`}
            onClick={onPick}
            aria-current={c.id === selected ? "page" : undefined}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2.5 text-sm lg:min-h-9"
          >
            <MessageSquareIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate">{c.title}</span>
          </Link>
          <DeleteChatButton id={c.id} title={c.title} active={c.id === selected} />
        </div>
      ))}
    </nav>
  );
}
