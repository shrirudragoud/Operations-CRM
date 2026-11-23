import type { Metadata } from "next";
import { AccessDenied } from "@/components/access-denied";
import { KeyForm } from "@/components/assistant/key-form";
import { PageHeader } from "@/components/page-header";
import { vaultConfigured } from "@/lib/ai/crypto";
import { loadThread } from "@/lib/ai/thread";
import type { AssistantStatus, ChatSummary } from "@/lib/ai/types";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";
import { AssistantShell } from "./assistant-shell";

export const metadata: Metadata = { title: "Assistant" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { allowed } = await requireArea("assistant");
  if (!allowed) return <><PageHeader title="Assistant" /><AccessDenied what="the assistant" /></>;

  const raw = (await searchParams).c;
  const selected = typeof raw === "string" && UUID.test(raw) ? raw : null;
  const supabase = await createClient();
  const [keyRow, chats, thread] = await Promise.all([
    supabase.from("ai_key").select("key_hint, model").maybeSingle(),
    supabase.from("ai_conversation").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(200),
    selected ? loadThread(supabase, selected) : Promise.resolve(null),
  ]);
  const status: AssistantStatus = { vaultConfigured: vaultConfigured(), hasKey: !!keyRow.data, keyHint: keyRow.data?.key_hint ?? null, model: keyRow.data?.model ?? null };
  const ready = status.vaultConfigured && status.hasKey;

  if (!ready) {
    return (
      <>
        <PageHeader title="Assistant" description="Ask about tasks, get them explained, or have them created. Every change is a draft you confirm." />
        <div className="max-w-xl space-y-4">
          <h2 className="font-medium">Connect your Gemini key</h2>
          <KeyForm status={status} />
        </div>
      </>
    );
  }

  const list: ChatSummary[] = (chats.data ?? []).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at }));
  return <AssistantShell status={status} chats={list} selected={selected} thread={thread} missing={!!selected && !thread} />;
}
