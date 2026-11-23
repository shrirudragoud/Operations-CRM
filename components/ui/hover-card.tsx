"use client"

import * as React from "react"
import { cn } from "cn"
import {
  HoverCard as HoverCardRoot,
  HoverCardContent as HoverCardContentPart,
  HoverCardTrigger as HoverCardTriggerPart,
} from "@ui-sdk/react/hover-card"

import {
  resolveAsChild,
  usePopupContainer,
  type AsChildProps,
} from "@/components/ui/overlay-compat"

function HoverCard({
  ...props
}: React.ComponentProps<typeof HoverCardRoot>) {
  return <HoverCardRoot container={usePopupContainer()} {...props} />
}

function HoverCardTrigger(
  props: React.ComponentProps<typeof HoverCardTriggerPart> & AsChildProps
) {
  return <HoverCardTriggerPart {...resolveAsChild(props)} />
}

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof HoverCardContentPart>) {
  return (
    <HoverCardContentPart
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 block w-64 max-w-none min-w-0 origin-(--transform-origin) rounded-lg border-0 bg-popover p-4 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-ending-style:animate-out data-ending-style:fade-out-0 data-ending-style:zoom-out-95",
        className
      )}
      {...props}
    />
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
