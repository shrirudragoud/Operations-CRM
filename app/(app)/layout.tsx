import { Suspense } from "react";
import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandSearch } from "@/components/command-search";
import { UserMenu } from "@/components/user-menu";
import { WelcomeToast } from "@/components/welcome-toast";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requireMe } from "@/lib/auth";
import { navFor } from "@/lib/nav";

// App shell for signed-in staff. ops.me() decides: no active staff row -> /no-access.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireMe();
  const items = navFor(me);
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <a href="#main" className="bg-background sr-only z-50 rounded p-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <AppSidebar me={me} items={items} />
      <SidebarInset>
        <header className="bg-background/95 sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <div className="flex flex-1 items-center">
            <CommandSearch items={items} />
          </div>
          <UserMenu me={me} />
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
          {children}
        </main>
      </SidebarInset>
      <Suspense>
        <WelcomeToast name={me.full_name} />
      </Suspense>
    </SidebarProvider>
  );
}
