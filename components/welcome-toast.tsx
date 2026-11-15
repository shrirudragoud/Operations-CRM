"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

/** Shows a one-time welcome after a first sign-in claims an invite (?welcome=1), then cleans the URL. */
export function WelcomeToast({ name }: { name: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (params.get("welcome") === "1") {
      toast.success(`Welcome to Hard-Code Ops, ${name.split(" ")[0]}!`, {
        description: "Your invite was accepted. The sidebar shows the areas you can use.",
      });
      router.replace(pathname);
    }
  }, [params, router, pathname, name]);
  return null;
}
