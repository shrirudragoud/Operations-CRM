import { z } from "zod";

// Rules for files on tasks. The database holds the same list (0039 task_attachment.mime, the bucket and the RPC);
// this module is what the upload form and the server actions check first, with messages people can act on.

export const TASK_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const TASK_FILE_MAX_PER_TASK = 100;
export const TASK_FILE_BUCKET = "task-files";
/** How many leading bytes the server reads to check what a file really is. */
export const TASK_FILE_HEAD_BYTES = 4096;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const TASK_FILE_TYPES = {
  "image/png": { ext: ["png"], kind: "image", label: "PNG image" },
  "image/jpeg": { ext: ["jpg", "jpeg"], kind: "image", label: "JPG image" },
  "image/webp": { ext: ["webp"], kind: "image", label: "WebP image" },
  "image/gif": { ext: ["gif"], kind: "image", label: "GIF image" },
  "application/pdf": { ext: ["pdf"], kind: "document", label: "PDF" },
  [DOCX]: { ext: ["docx"], kind: "document", label: "Word document" },
  [XLSX]: { ext: ["xlsx"], kind: "document", label: "Excel sheet" },
  [PPTX]: { ext: ["pptx"], kind: "document", label: "PowerPoint deck" },
  "text/csv": { ext: ["csv"], kind: "document", label: "CSV" },
  "text/plain": { ext: ["txt"], kind: "document", label: "Text file" },
  "text/markdown": { ext: ["md", "markdown"], kind: "document", label: "Markdown file" },
} as const;

export type TaskFileMime = keyof typeof TASK_FILE_TYPES;
export type TaskFileKind = "image" | "document";

export const TASK_FILE_MIMES = Object.keys(TASK_FILE_TYPES) as TaskFileMime[];
export const TASK_FILE_ACCEPT = [...TASK_FILE_MIMES, ...Object.values(TASK_FILE_TYPES).flatMap((t) => t.ext.map((e) => `.${e}`))].join(",");
/** Images the browser may show inline. Every other file is served as a download. */
export const INLINE_IMAGE_MIMES: readonly TaskFileMime[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const TASK_FILE_TYPE_ERROR =
  "That file type is not allowed. Use an image (PNG, JPG, WebP, GIF), PDF, Word, Excel, PowerPoint, CSV, text or Markdown file.";

export function isTaskFileMime(mime: string): mime is TaskFileMime {
  return Object.hasOwn(TASK_FILE_TYPES, mime);
}

const BY_EXT = new Map<string, TaskFileMime>(
  (Object.entries(TASK_FILE_TYPES) as [TaskFileMime, { ext: readonly string[] }][]).flatMap(([mime, t]) => t.ext.map((e) => [e, mime] as const)),
);

export function fileExtension(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m?.[1]?.toLowerCase() ?? "";
}

/**
 * The type to store. Browsers often send an empty or generic type (.md, .csv on Windows), so when the claimed type is
 * not on the list the extension decides. The claimed type wins when it is on the list. Null means refuse.
 */
export function resolveTaskFileMime(name: string, claimed: string): TaskFileMime | null {
  const c = claimed.trim().toLowerCase().split(";")[0] ?? "";
  if (isTaskFileMime(c)) return c;
  if (c === "" || c === "application/octet-stream" || c === "application/vnd.ms-excel" || c === "text/x-markdown") {
    return BY_EXT.get(fileExtension(name)) ?? null;
  }
  return null;
}

const ZIP_ENTRY_PREFIXES = ["[Content_Types].xml", "_rels/", "docProps/", "word/", "xl/", "ppt/"];

function startsWith(bytes: Uint8Array, ...v: number[]) {
  return v.every((b, i) => bytes[i] === b);
}
function ascii(bytes: Uint8Array, from: number, len: number) {
  return String.fromCharCode(...bytes.slice(from, from + len));
}

/** Plain text: no NUL bytes and valid UTF-8 (a multi-byte character cut at the end of the sample is fine). */
function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes.includes(0)) return false;
  let end = bytes.length;
  for (let back = 0; back < 4 && end > 0; back++) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, end));
      return true;
    } catch {
      end -= 1;
    }
  }
  return false;
}

/** Office files are ZIP packages; the first entry of one made by Office or LibreOffice is one of its own parts. */
function looksLikeOffice(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, 0x50, 0x4b, 0x03, 0x04) || bytes.length < 31) return false;
  const nameLen = (bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8);
  const entry = ascii(bytes, 30, Math.min(nameLen, 120));
  return ZIP_ENTRY_PREFIXES.some((p) => entry.startsWith(p));
}

/** Does the start of the file match what its type says? Images and PDF by magic number, text by content. */
export function taskFileMatches(mime: TaskFileMime, head: Uint8Array): boolean {
  switch (mime) {
    case "application/pdf": return startsWith(head, 0x25, 0x50, 0x44, 0x46);
    case "image/jpeg": return startsWith(head, 0xff, 0xd8, 0xff);
    case "image/png": return startsWith(head, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/gif": return ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a";
    case "image/webp": return ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP";
    case DOCX:
    case XLSX:
    case PPTX: return looksLikeOffice(head);
    case "text/csv":
    case "text/plain":
    case "text/markdown": return looksLikeText(head);
  }
}

export type TaskFileCheck = { ok: true; mime: TaskFileMime; kind: TaskFileKind } | { ok: false; error: string };

/** The checks that need no bytes: size and type. */
export function checkTaskFile(file: { name: string; size: number; type: string }): TaskFileCheck {
  if (file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > TASK_FILE_MAX_BYTES) return { ok: false, error: "That file is over 25 MB. Choose a smaller one." };
  const mime = resolveTaskFileMime(file.name, file.type);
  if (!mime) return { ok: false, error: TASK_FILE_TYPE_ERROR };
  return { ok: true, mime, kind: TASK_FILE_TYPES[mime].kind };
}

/** A storage-safe name: letters, digits, dot, dash and underscore; never starts with a dot; at most 100 characters. */
export function safeTaskFileName(original: string, mime: TaskFileMime): string {
  const ext = fileExtension(original);
  const known: readonly string[] = TASK_FILE_TYPES[mime].ext;
  const keep = known.includes(ext) ? ext : known[0];
  const base = original
    .replace(/\.[A-Za-z0-9]{1,8}$/, "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/\.{2,}/g, ".");
  return `${(base || "file").slice(0, 60)}.${keep}`;
}

/** The text shown for a file: what the person called it, trimmed to what the database accepts. */
export function displayTaskFileName(original: string, mime: TaskFileMime): string {
  const t = original.replace(/[\r\n\t]+/g, " ").trim().slice(0, 160);
  return t || `file.${TASK_FILE_TYPES[mime].ext[0]}`;
}

const PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;

export function taskFilePath(taskId: string, mime: TaskFileMime, name: string, uuid: string = crypto.randomUUID()): string {
  return `${taskId}/${uuid}/${safeTaskFileName(name, mime)}`;
}

export function isTaskFilePath(path: string, taskId: string): boolean {
  return PATH_RE.test(path) && path.startsWith(`${taskId}/`);
}

/** Inline images in a description point at an attachment as `task-file:<id>`. */
export const TASK_FILE_REF = /^task-file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const taskFileRef = (id: string) => `task-file:${id}`;

const fileName = z.string().trim().min(1, "Choose a file.").max(160, "Keep the file name under 160 characters.");

export const prepareTaskUploadSchema = z.object({
  task_id: z.uuid(),
  name: fileName,
  mime: z.string().max(120),
  size: z.number().int().min(1, "That file is empty.").max(TASK_FILE_MAX_BYTES, "That file is over 25 MB. Choose a smaller one."),
});

export const finishTaskUploadSchema = z.object({
  task_id: z.uuid(),
  path: z.string().max(200),
  name: fileName,
  mime: z.string().max(120),
  comment_id: z.uuid().optional(),
  inline: z.boolean().optional(),
});

export const taskAttachmentIdSchema = z.object({ id: z.uuid() });

export type PrepareTaskUploadInput = z.input<typeof prepareTaskUploadSchema>;
export type FinishTaskUploadInput = z.input<typeof finishTaskUploadSchema>;
