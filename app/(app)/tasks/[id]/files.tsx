"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, UploadIcon, XIcon } from "lucide-react";
import { Button } from "@ui-sdk/react/button";
import { FileInput, FileInputDropzone, FileInputTrigger } from "@ui-sdk/react/file-input";
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from "@ui-sdk/react/segmented-control";
import { FileList, type FileLayout } from "@/components/tasks/file-views";
import { rejectionMessage, uploadTaskFiles } from "@/components/tasks/upload-task-files";
import { TASK_FILE_ACCEPT, TASK_FILE_MAX_BYTES } from "@/lib/schemas/task-files";
import type { FileView } from "@/lib/task-file-view";

const ALLOWED = "Images (PNG, JPG, WebP, GIF), PDF, Word, Excel, PowerPoint, CSV, text and Markdown files, up to 25 MB each.";
const ACCEPT = TASK_FILE_ACCEPT.split(",");
const NO_FILES: File[] = [];

type Problem = { key: string; text: string };

/** The files on a task: drop, paste or browse to add; thumbnails or rows to look at them. */
export function Files({ taskId, files, canUpload }: { taskId: string; files: FileView[]; canUpload: boolean }) {
  const router = useRouter();
  const [layout, setLayout] = useState<FileLayout>("list");
  const [uploading, setUploading] = useState<{ key: string; name: string }[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const serial = useRef(0);

  function addProblem(text: string) {
    setProblems((p) => [...p, { key: `p${serial.current++}`, text }]);
  }

  function send(list: File[]) {
    if (list.length === 0) return;
    const keys = new Map(list.map((f) => [f, `u${serial.current++}`] as const));
    setUploading((u) => [...u, ...list.map((f) => ({ key: keys.get(f)!, name: f.name }))]);
    void uploadTaskFiles(taskId, list, {
      onSettled: (file, outcome) => {
        setUploading((u) => u.filter((x) => x.key !== keys.get(file)));
        if (outcome.error) addProblem(`${outcome.name}: ${outcome.error}`);
      },
    }).then(() => router.refresh());
  }

  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    if (!canUpload) return;
    function onPaste(e: ClipboardEvent) {
      const files = [...(e.clipboardData?.files ?? [])];
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (files.length === 0 || el?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      sendRef.current(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canUpload]);

  return (
    <section aria-label="Task files" className="space-y-3">
      {canUpload && (
        <FileInput
          multiple
          accept={ACCEPT}
          maxSize={TASK_FILE_MAX_BYTES}
          value={NO_FILES}
          onValueChange={(_, details) => send(details.added)}
          onReject={(rejected) => rejected.forEach((r) => addProblem(`${r.file.name}: ${rejectionMessage(r.file as File)}`))}
        >
          <FileInputDropzone className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-4 text-center text-sm data-dragging:bg-muted">
            <UploadIcon aria-hidden className="text-muted-foreground size-5" />
            <p>Drop files here, paste them anywhere on this page, or</p>
            <FileInputTrigger>Browse files</FileInputTrigger>
            <p className="text-muted-foreground text-xs">{ALLOWED}</p>
          </FileInputDropzone>
        </FileInput>
      )}

      {problems.length > 0 && (
        <ul className="space-y-1" aria-label="Upload problems">
          {problems.map((p) => (
            <li key={p.key} className="flex items-start gap-1">
              <p role="alert" className="text-destructive min-w-0 flex-1 text-xs">{p.text}</p>
              <Button
                type="button"
                aria-label="Dismiss this message"
                className="flex size-5 shrink-0 items-center justify-center rounded p-0 [&_svg]:size-3.5"
                onClick={() => setProblems((all) => all.filter((x) => x.key !== p.key))}
              >
                <XIcon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {uploading.length > 0 && (
        <ul className="space-y-1" aria-label="Uploading">
          {uploading.map((u) => (
            <li key={u.key} className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2Icon aria-hidden className="size-4 animate-spin" /> Uploading {u.name}
            </li>
          ))}
        </ul>
      )}

      {files.length === 0 ? (
        uploading.length === 0 && (
          <p className="text-muted-foreground text-sm">{canUpload ? "No files yet." : "No files on this task."}</p>
        )
      ) : (
        <>
          <SegmentedControl aria-label="File layout" value={layout} onValueChange={(v) => setLayout(v as FileLayout)}>
            <SegmentedControlIndicator />
            <SegmentedControlItem value="list">List</SegmentedControlItem>
            <SegmentedControlItem value="grid">Grid</SegmentedControlItem>
          </SegmentedControl>
          <FileList files={files} layout={layout} label="Files" />
        </>
      )}
    </section>
  );
}
