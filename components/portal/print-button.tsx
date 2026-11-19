"use client";

import { PrinterIcon } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="hover:bg-muted focus-visible:ring-ring/50 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium outline-none focus-visible:ring-[3px] print:hidden"
    >
      <PrinterIcon aria-hidden className="size-4" />
      Print or save as PDF
    </button>
  );
}
