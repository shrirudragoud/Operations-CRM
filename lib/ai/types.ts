// Shapes shared between the assistant's server actions and its screens. Nothing here may import server-only code.

export type DraftStatus = "pending" | "running" | "done" | "failed" | "cancelled";

/** A new task laid out field by field, so the card can show it like a task and not as one sentence. */
export type TaskPreview = {
  title: string;
  description: string | null;
  assignees: string[];
  shared: boolean;
  dueLabel: string | null;
  priority: number;
  department: string | null;
  parent: boolean;
};

export type CardRow = { label: string; value: string };

/** A place a finished draft points at. `ref` is set when the chat can link it as `[[kind:id|label]]`. */
export type DraftLink = { href: string; label: string; ref: { kind: "task" | "meeting" | "event" | "deal" | "institution"; id: string } | null };

export type DraftCard = {
  id: string;
  kind: string;
  /** The one-line headline. Warnings the assistant found (busy people, who is told) are in `notes`. */
  summary: string;
  notes: string[];
  /** Field by field layout for kinds other than a single new task. */
  rows: CardRow[];
  /** Set for a single new task. */
  task: TaskPreview | null;
  status: DraftStatus;
  error: string | null;
  /** Ids of tasks the draft created or changed. */
  taskIds: string[];
  /** Where the finished draft can be opened. */
  links: DraftLink[];
  expiresAt: string;
  expired: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "model";
  text: string;
  draftIds: string[];
  error: boolean;
  at: string;
};

export type Thread = { id: string; title: string; messages: ChatMessage[]; drafts: DraftCard[] };

export type ChatSummary = { id: string; title: string; updatedAt: string };

export type ModelOption = { id: string; label: string };

export type AssistantStatus = {
  vaultConfigured: boolean;
  hasKey: boolean;
  keyHint: string | null;
  model: string | null;
};
