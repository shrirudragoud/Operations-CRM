"use client";

import Link from "next/link";
import { KeyRoundIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import { DEPARTMENT_LABELS, ROLE_LABELS, type Me } from "@/lib/permissions";

export function UserMenu({ me }: { me: Me }) {
  const { theme, setTheme } = useTheme();
  const depts = me.role === "founder" ? "All departments" : me.departments.map((d) => DEPARTMENT_LABELS[d]).join(", ");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={`Account menu for ${me.full_name}`}>
          <Avatar className="size-8">
            <AvatarFallback>{initials(me.full_name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="grid gap-0.5">
            <span className="truncate font-medium">{me.full_name}</span>
            <span className="text-muted-foreground truncate text-xs">{me.email}</span>
            <span className="text-muted-foreground text-xs">
              {ROLE_LABELS[me.role]}
              {depts ? ` · ${depts}` : ""}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light"><SunIcon aria-hidden /> Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><MoonIcon aria-hidden /> Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><MonitorIcon aria-hidden /> System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account"><KeyRoundIcon aria-hidden /> Account and password</Link>
        </DropdownMenuItem>
        <form action="/auth/signout" method="post">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOutIcon aria-hidden /> Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
