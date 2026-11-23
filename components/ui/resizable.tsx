"use client"

import * as React from "react"
import { cn } from "cn"
import {
  Resizable,
  ResizableHandle as ResizableHandlePrimitive,
  ResizablePanel as ResizablePanelPrimitive,
} from "@ui-sdk/react/resizable"

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof Resizable>) {
  return (
    <Resizable
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full min-h-0 w-full rounded-none border-0 data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePanelPrimitive>) {
  return (
    <ResizablePanelPrimitive
      data-slot="resizable-panel"
      className={cn("p-0", className)}
      {...props}
    />
  )
}

function ResizableHandle({
  withHandle,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof ResizableHandlePrimitive>, "children"> & {
  children?: React.ReactNode
  withHandle?: boolean
}) {
  return (
    <ResizableHandlePrimitive
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />
      )}
      {children}
    </ResizableHandlePrimitive>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
