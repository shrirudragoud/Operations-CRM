import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Server-rendered pagination driven by URL params; `href(page)` builds the link for a page. */
export function Pager({
  page, pages, total, noun, href,
}: { page: number; pages: number; total: number; noun: [string, string]; href: (page: number) => string }) {
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
      <p className="text-muted-foreground text-sm" aria-live="polite">
        Page {page} of {pages} · {total} {total === 1 ? noun[0] : noun[1]}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)} rel="prev"><ChevronLeftIcon aria-hidden /> Previous</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled><ChevronLeftIcon aria-hidden /> Previous</Button>
        )}
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)} rel="next">Next <ChevronRightIcon aria-hidden /></Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>Next <ChevronRightIcon aria-hidden /></Button>
        )}
      </div>
    </nav>
  );
}
