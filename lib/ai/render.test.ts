import { describe, expect, it } from "vitest";
import { parseInline, parseMessage } from "./render";

const ID = "11111111-1111-4111-8111-111111111111";

describe("parseInline", () => {
  it("finds task links and bold text, and leaves everything else as text", () => {
    expect(parseInline(`See [[task:${ID}|Fix the <b>demo</b>]] and **now**.`)).toEqual([
      { t: "text", text: "See " },
      { t: "task", id: ID, title: "Fix the <b>demo</b>" },
      { t: "text", text: " and " },
      { t: "bold", text: "now" },
      { t: "text", text: "." },
    ]);
  });
  it("links meetings, events, deals and institutions, and refuses an unknown kind", () => {
    for (const kind of ["meeting", "event", "deal", "institution"] as const) {
      expect(parseInline(`[[${kind}:${ID}|Name]]`)).toEqual([{ t: "ref", kind, id: ID, title: "Name" }]);
    }
    expect(parseInline(`[[user:${ID}|Name]]`)).toEqual([{ t: "text", text: `[[user:${ID}|Name]]` }]);
  });
  it("does not link a made-up id", () => {
    expect(parseInline("[[task:javascript:alert(1)|x]]")).toEqual([{ t: "text", text: "[[task:javascript:alert(1)|x]]" }]);
  });
});

describe("parseMessage", () => {
  it("groups paragraphs and bullet lists", () => {
    const blocks = parseMessage("Two late:\n- one\n- **two**\n\nDone.\r\nBye");
    expect(blocks.map((b) => b.t)).toEqual(["p", "ul", "p"]);
    expect(blocks[1]).toEqual({ t: "ul", items: [[{ t: "text", text: "one" }], [{ t: "bold", text: "two" }]] });
    expect(blocks[2]).toEqual({ t: "p", inline: [{ t: "text", text: "Done.\nBye" }] });
  });
  it("is empty for blank text", () => {
    expect(parseMessage("  \n ")).toEqual([]);
  });
});
