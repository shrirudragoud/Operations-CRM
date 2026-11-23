"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRoundIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { listAiModels, removeAiKey, saveAiKey, setAiModel } from "@/lib/actions/assistant";
import type { AssistantStatus, ModelOption } from "@/lib/ai/types";

/** Add, change or remove the person's own Gemini key. The key is sent once, stored encrypted and never shown again. */
export function KeyForm({ status }: { status: AssistantStatus }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState(status.model ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!status.hasKey) return;
    let live = true;
    void listAiModels().then((r) => {
      if (!live || !r.ok) return;
      setModels(r.data.models);
      setModel(r.data.model);
    });
    return () => {
      live = false;
    };
  }, [status.hasKey, status.keyHint]);

  if (!status.vaultConfigured) {
    return <p className="text-sm">The assistant is not switched on for this server yet. Ask the founder to finish its setup.</p>;
  }

  async function save() {
    setBusy(true);
    const res = await saveAiKey({ key });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    setKey("");
    toast.success("Key saved");
    router.refresh();
  }

  async function pick(next: string) {
    const before = model;
    setModel(next);
    const res = await setAiModel({ model: next });
    if (!res.ok) {
      setModel(before);
      return void toast.error(res.error);
    }
    toast.success("Model changed");
  }

  async function remove() {
    setBusy(true);
    const res = await removeAiKey();
    setBusy(false);
    setConfirmRemove(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Key removed");
    router.refresh();
  }

  return (
    <div className="space-y-6 text-sm">
      {status.hasKey && (
        <Alert>
          <KeyRoundIcon aria-hidden />
          <AlertTitle>Key saved</AlertTitle>
          <AlertDescription>
            <span className="font-mono">{status.keyHint}</span> is stored encrypted and only used to answer your own messages.
          </AlertDescription>
        </Alert>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="gemini-key">{status.hasKey ? "Replace your Gemini API key" : "Your Gemini API key"}</FieldLabel>
            <Input id="gemini-key" type="password" autoComplete="off" spellCheck={false} placeholder="Paste your key" className="h-10 sm:h-9" value={key} onChange={(e) => setKey(e.target.value)} />
            <FieldDescription>Create a free key in Google AI Studio. Usage is billed to your own Google account.</FieldDescription>
          </Field>
          <Button type="submit" className="h-10 w-full sm:h-9 sm:w-auto sm:self-start" disabled={busy || key.trim() === ""}>
            {busy ? <Spinner /> : null} Save key
          </Button>
        </FieldGroup>
      </form>
      {status.hasKey && (
        <FieldGroup>
          {models.length > 0 && (
            <Field>
              <FieldLabel htmlFor="gemini-model">Model</FieldLabel>
              <select
                id="gemini-model"
                value={model}
                onChange={(e) => void pick(e.target.value)}
                className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-md border px-2 text-base shadow-xs outline-none focus-visible:ring-3 sm:h-9 sm:text-sm"
              >
                {!models.some((m) => m.id === model) && <option value={model}>{model}</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <FieldDescription>Flash models are fast and cheap. Change this if you hit a limit.</FieldDescription>
            </Field>
          )}
          <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="h-10 w-full sm:h-9 sm:w-auto sm:self-start">
                <Trash2Icon aria-hidden /> Remove key
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove your key?</AlertDialogTitle>
                <AlertDialogDescription>The assistant stops working for you until you add a key again. Your saved chats stay.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={busy}
                  onClick={(e) => {
                    e.preventDefault();
                    void remove();
                  }}
                >
                  {busy && <Spinner />} Yes, remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </FieldGroup>
      )}
    </div>
  );
}
