"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUpIcon, MicIcon, SparklesIcon } from "lucide-react";
import { DraftCardView } from "@/components/assistant/draft-card";
import { MessageText } from "@/components/assistant/message-text";
import { useVoice } from "@/components/assistant/use-voice";
import { VoiceDock } from "@/components/assistant/voice-dock";
import { VoiceSettings } from "@/components/assistant/voice-settings";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { loadAssistantThread, sendAssistantMessage } from "@/lib/actions/assistant";
import { plainSpeech } from "@/lib/ai/live";
import type { DraftCard, Thread } from "@/lib/ai/types";
import { cn } from "cn";

const SUGGESTIONS = ["What is overdue for me?", "Who has the most open work?", "Create a task for me to call the school on Friday"];
const TASK_SUGGESTIONS = ["Explain this task", "Break this task into subtasks", "Who is working on this?"];

function AssistantAvatar() {
  return (
    <Avatar className="mt-0.5 size-7 shrink-0">
      <AvatarFallback className="bg-primary/10 text-primary">
        <SparklesIcon aria-hidden className="size-3.5" />
      </AvatarFallback>
    </Avatar>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap">{text}</div>
    </div>
  );
}

export function Chat({
  initial, taskId, compact = false, voice: voiceEnabled = true, onCreated, onThread, className,
}: { initial: Thread | null; taskId?: string | null; compact?: boolean; voice?: boolean; onCreated?: (id: string) => void; onThread?: (t: Thread) => void; className?: string }) {
  const [thread, setThread] = useState<Thread | null>(initial);
  const [text, setText] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const voice = useVoice({
    taskId,
    chatId: thread?.id ?? null,
    onChat: (id) => onCreated?.(id),
    onSaved: async (id, done) => {
      const res = await loadAssistantThread({ id });
      if (res.ok) {
        setThread(res.data);
        onThread?.(res.data);
        done();
      }
    },
  });
  const voiceOn = voice.state !== "off";

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length, asking, voice.turns, voice.drafts.length]);

  async function send(raw: string) {
    const body = raw.trim();
    if (!body || asking) return;
    setAsking(body);
    setText("");
    const res = await sendAssistantMessage({ conversation_id: thread?.id, text: body, task_id: taskId ?? undefined });
    setAsking(null);
    if (!res.ok) {
      toast.error(res.error);
      setText(body);
      return;
    }
    if (!thread) onCreated?.(res.data.id);
    setThread(res.data);
    onThread?.(res.data);
  }

  async function reload() {
    if (!thread) return;
    const res = await loadAssistantThread({ id: thread.id });
    if (res.ok) {
      setThread(res.data);
      onThread?.(res.data);
    }
  }

  function patchDraft(d: DraftCard) {
    if (!thread) return;
    const next = { ...thread, drafts: thread.drafts.map((x) => (x.id === d.id ? d : x)) };
    setThread(next);
    onThread?.(next);
  }

  function changeDraft(d: DraftCard) {
    patchDraft(d);
    voice.setDraft(d);
  }

  const drafts = new Map([...(thread?.drafts ?? []), ...voice.drafts].map((d) => [d.id, d]));
  const shown = new Set([...voice.turns.flatMap((t) => t.draftIds), ...(thread?.messages ?? []).flatMap((m) => m.draftIds)]);
  const loose = voice.drafts.filter((d) => !shown.has(d.id));
  const empty = (!thread || thread.messages.length === 0) && !voiceOn && voice.turns.length === 0;
  const suggestions = [...(taskId ? TASK_SUGGESTIONS : []), ...SUGGESTIONS].slice(0, compact ? 4 : 5);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div role="log" aria-live="polite" aria-label="Conversation" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain py-2 pr-1">
        {empty && !asking && (
          <Empty className="border-0 p-2 sm:p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>How can I help?</EmptyTitle>
              <EmptyDescription>Ask me to find, explain or create tasks. I draft changes and you confirm them.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="max-w-full">
              {voiceEnabled && voice.supported && (
                <div className="flex w-full items-center gap-2">
                  <Button type="button" size="lg" className="h-11 flex-1 rounded-full" onClick={() => void voice.start()}>
                    <MicIcon aria-hidden /> Talk to the assistant
                  </Button>
                  <VoiceSettings />
                </div>
              )}
              <div className="flex w-full flex-col gap-2">
                {suggestions.map((s) => (
                  <Button key={s} type="button" variant="outline" className="h-auto min-h-10 justify-start py-2 text-left font-normal whitespace-normal" onClick={() => void send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </EmptyContent>
          </Empty>
        )}
        {thread?.messages.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} text={m.text} />
          ) : (
            <div key={m.id} className="flex max-w-full gap-2.5">
              <AssistantAvatar />
              <div className="min-w-0 flex-1 space-y-2 text-sm leading-relaxed">
                <div className={cn("pt-1", m.error && "text-destructive")}>
                  <MessageText text={m.text} />
                </div>
                {m.draftIds.map((id) => {
                  const d = drafts.get(id);
                  return d ? <DraftCardView key={id} draft={d} onChange={changeDraft} onStale={reload} /> : null;
                })}
              </div>
            </div>
          ),
        )}
        {voice.turns.map((t) =>
          t.role === "user" ? (
            <UserBubble key={`v${t.id}`} text={plainSpeech(t.text)} />
          ) : (
            <div key={`v${t.id}`} className="flex max-w-full gap-2.5">
              <AssistantAvatar />
              <div className="min-w-0 flex-1 space-y-2 text-sm leading-relaxed">
                <div className="pt-1 break-words">{plainSpeech(t.text)}</div>
                {t.draftIds.map((id) => {
                  const d = drafts.get(id);
                  return d ? <DraftCardView key={id} draft={d} onChange={changeDraft} onStale={reload} /> : null;
                })}
              </div>
            </div>
          ),
        )}
        {loose.length > 0 && (
          <div className="flex max-w-full gap-2.5">
            <AssistantAvatar />
            <div className="min-w-0 flex-1 space-y-2 text-sm leading-relaxed">
              {loose.map((d) => (
                <DraftCardView key={d.id} draft={d} onChange={changeDraft} onStale={reload} />
              ))}
            </div>
          </div>
        )}
        {asking && (
          <>
            <UserBubble text={asking} />
            <div className="text-muted-foreground flex items-center gap-2.5 text-sm" role="status">
              <AssistantAvatar />
              <Spinner /> Working on it…
            </div>
          </>
        )}
        <div ref={end} />
      </div>
      {voice.message && (
        <p role="alert" className="text-destructive pt-2 text-sm break-words">
          {voice.message}
        </p>
      )}
      {voiceOn ? (
        <VoiceDock
          state={voice.state}
          muted={voice.muted}
          started={voice.turns.length > 0}
          soundBlocked={voice.soundBlocked}
          bargeIn={voice.bargeIn}
          getLevel={voice.getLevel}
          onMute={voice.toggleMute}
          onStop={voice.stop}
          onInterrupt={voice.interrupt}
          onEnableSound={voice.enableSound}
          onBargeIn={voice.toggleBargeIn}
        />
      ) : (
        <form
          className="pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <InputGroup className="h-auto">
            <InputGroupTextarea
              aria-label="Message the assistant"
              placeholder={compact ? "Ask about tasks…" : "Ask about tasks, or tell me what to create…"}
              value={text}
              maxLength={4000}
              rows={1}
              className="max-h-40 min-h-12"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Phones keep Enter for a new line; a hardware keyboard sends.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                  e.preventDefault();
                  void send(text);
                }
              }}
            />
            <InputGroupAddon align="block-end" className="justify-between">
              <span className="text-muted-foreground hidden text-xs [@media(pointer:fine)]:inline">Enter to send, Shift+Enter for a new line</span>
              <div className="ml-auto flex items-center gap-2">
                {voiceEnabled && voice.supported && <VoiceSettings />}
                {voiceEnabled && voice.supported && (
                  <InputGroupButton type="button" variant="secondary" size="sm" className="rounded-full px-3" disabled={asking !== null} onClick={() => void voice.start()}>
                    <MicIcon aria-hidden /> Talk
                  </InputGroupButton>
                )}
                <InputGroupButton type="submit" variant="default" size="icon-sm" className="rounded-full" aria-label="Send" disabled={asking !== null || text.trim() === ""}>
                  {asking ? <Spinner /> : <ArrowUpIcon aria-hidden />}
                </InputGroupButton>
              </div>
            </InputGroupAddon>
          </InputGroup>
        </form>
      )}
    </div>
  );
}
