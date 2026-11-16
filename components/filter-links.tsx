import Link from "next/link";
import { Button } from "@/components/ui/button";

/** A row of link-buttons that set one URL filter; the current value is marked with aria-current. */
export function FilterLinks<T extends string>({
  label, current, options, href,
}: { label: string; current: T; options: { value: T; label: string }[]; href: (value: T) => string }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      <span className="text-muted-foreground mr-1 text-sm">{label}</span>
      {options.map((o) => (
        <Button key={o.value || "all"} asChild size="sm" variant={current === o.value ? "secondary" : "ghost"}>
          <Link href={href(o.value)} aria-current={current === o.value ? "true" : undefined}>{o.label}</Link>
        </Button>
      ))}
    </div>
  );
}
