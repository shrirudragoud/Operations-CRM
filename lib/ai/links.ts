// How the assistant points at a record in its replies: `[[kind:UUID|Title]]`. The chat turns it into a link to that record's page.
// Nothing here touches the network, the browser or the database, so the server, the chat and the tests all share it.

export const REF_KINDS = ["task", "meeting", "event", "deal", "institution"] as const;
export type RefKind = (typeof REF_KINDS)[number];

const PATH: Record<RefKind, string> = { task: "/tasks", meeting: "/calendar", event: "/workshop", deal: "/sales", institution: "/institutions" };

export const refPath = (kind: RefKind, id: string): string => `${PATH[kind]}/${id}`;

/** The text the model copies into a reply. The title is cleaned so it cannot break out of the link. */
export function refLink(kind: RefKind, id: string, title: string, fallback = "Open"): string {
  const clean = title.replace(/[[\]|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || fallback;
  return `[[${kind}:${id}|${clean}]]`;
}
