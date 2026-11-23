"use client"

import * as React from "react"
import { cn } from "cn"
import {
  Tooltip as TooltipRoot,
  TooltipArrow,
  TooltipContent as TooltipContentPart,
  TooltipTrigger as TooltipTriggerPart,
} from "@ui-sdk/react/tooltip"

import {
  resolveAsChild,
  usePopupContainer,
  type AsChildProps,
} from "@/components/ui/overlay-compat"

const TooltipDelayContext = React.createContext(0)

function TooltipProvider({
  delayDuration = 0,
  children,
}: {
  delayDuration?: number
  children?: React.ReactNode
}) {
  return (
    <TooltipDelayContext.Provider value={delayDuration}>
      {children}
    </TooltipDelayContext.Provider>
  )
}

function Tooltip({
  delay,
  delayDuration,
  ...props
}: React.ComponentProps<typeof TooltipRoot> & { delayDuration?: number }) {
  const inherited = React.useContext(TooltipDelayContext)
  return (
    <TooltipRoot
      container={usePopupContainer()}
      delay={delay ?? delayDuration ?? inherited}
      {...props}
    />
  )
}

function TooltipTrigger(
  props: React.ComponentProps<typeof TooltipTriggerPart> & AsChildProps
) {
  return <TooltipTriggerPart {...resolveAsChild(props)} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  hidden,
  ...props
}: Omit<React.ComponentProps<typeof TooltipContentPart>, "children"> & {
  children?: React.ReactNode
}) {
  if (hidden) return null
  return (
    <TooltipContentPart
      sideOffset={sideOffset}
      className={cn(
        "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-ending-style:animate-out data-ending-style:fade-out-0 data-ending-style:zoom-out-95",
        className
      )}
      {...props}
    >
      {children}
      <TooltipArrow className="absolute z-50 size-2.5 rotate-45 rounded-[2px] bg-foreground data-[side=bottom]:bottom-full data-[side=bottom]:left-(--arrow-offset) data-[side=bottom]:translate-y-[calc(50%+2px)] data-[side=bottom]:-translate-x-1/2 data-[side=left]:top-(--arrow-offset) data-[side=left]:left-full data-[side=left]:-translate-x-[calc(50%+2px)] data-[side=left]:-translate-y-1/2 data-[side=right]:top-(--arrow-offset) data-[side=right]:right-full data-[side=right]:translate-x-[calc(50%+2px)] data-[side=right]:-translate-y-1/2 data-[side=top]:top-full data-[side=top]:left-(--arrow-offset) data-[side=top]:-translate-x-1/2 data-[side=top]:-translate-y-[calc(50%+2px)]" />
    </TooltipContentPart>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
