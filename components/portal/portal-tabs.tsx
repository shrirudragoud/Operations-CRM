"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTab } from "@ui-sdk/react/tabs";
import { activePortalTab, type PortalTab } from "@/lib/portal";

/** Route tabs for /me. Each tab is a link; the path decides which one is selected (ui-sdk "Route Tabs"). */
export function PortalTabs({ tabs }: { tabs: PortalTab[] }) {
  const pathname = usePathname();
  const value = activePortalTab(tabs, pathname) ?? tabs[0]?.id ?? "";
  return (
    <Tabs value={value} className="mb-6">
      <TabsList aria-label="My space" className="flex w-full flex-wrap gap-1 border-b pb-1">
        {tabs.map((t) => (
          <TabsTab
            key={t.id}
            value={t.id}
            render={<Link href={t.href} />}
            className="data-[selected]:bg-secondary data-[selected]:text-secondary-foreground hover:bg-muted focus-visible:ring-ring/50 rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-[3px]"
          >
            {t.label}
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  );
}
