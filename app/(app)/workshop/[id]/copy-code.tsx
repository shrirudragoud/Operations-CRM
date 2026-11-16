"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The cohort code, with one-click copy (it is what students type into the IDE). */
export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Copy cohort code ${code}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      <span className="font-mono">{code}</span> {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
    </Button>
  );
}
