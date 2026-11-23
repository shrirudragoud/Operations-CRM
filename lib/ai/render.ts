// Turns an assistant reply into plain data the chat draws with React elements. Nothing here produces HTML, so a reply can never inject markup.

import type { RefKind } from "@/lib/ai/links";

export type Inline =
  | { t: "text"; text: string }
  | { t: "bold"; text: string }
  | { t: "task"; id: string; title: string }
  | { t: "ref"; kind: Exclude<RefKind, "task">; id: string; title: string };
export type Block = { t: "p"; inline: Inline[] } | { t: "ul"; items: Inline[][] };

const INLINE = /\[\[(task|meeting|event|deal|institution):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|([^\]\n]{1,100})\]\]|\*\*([^*\n]{1,200})\*\*/gi;
const BULLET = /^\s*[-*•]\s+(.*)$/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ t: "text", text: text.slice(last, m.index) });
    if (m[1]) {
      const kind = m[1].toLowerCase() as RefKind;
      const id = m[2]!.toLowerCase();
      const title = m[3]!.trim();
      if (kind === "task") out.push({ t: "task", id, title: title || "Task" });
      else out.push({ t: "ref", kind, id, title: title || "Open" });
    } else out.push({ t: "bold", text: m[4]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", text: text.slice(last) });
  return out;
}

export function parseMessage(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", inline: parseInline(para.join("\n")) });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ t: "ul", items: list });
    list = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      list.push(parseInline(bullet[1]!));
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}
