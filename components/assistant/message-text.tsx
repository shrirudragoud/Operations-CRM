import Link from "next/link";
import { refPath } from "@/lib/ai/links";
import { parseMessage, type Inline } from "@/lib/ai/render";

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((it, i) =>
        it.t === "task" ? (
          <Link key={i} href={`/tasks/${it.id}`} className="text-primary font-medium underline underline-offset-2">
            {it.title}
          </Link>
        ) : it.t === "ref" ? (
          <Link key={i} href={refPath(it.kind, it.id)} className="text-primary font-medium underline underline-offset-2">
            {it.title}
          </Link>
        ) : it.t === "bold" ? (
          <strong key={i}>{it.text}</strong>
        ) : (
          <span key={i}>{it.text}</span>
        ),
      )}
    </>
  );
}

/** A reply drawn as React elements only; links are internal task links built from validated ids. */
export function MessageText({ text }: { text: string }) {
  return (
    <div className="space-y-2 break-words">
      {parseMessage(text).map((b, i) =>
        b.t === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>
                <Inlines items={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-line">
            <Inlines items={b.inline} />
          </p>
        ),
      )}
    </div>
  );
}
