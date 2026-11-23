"use client"

import * as React from "react"
import { cn } from "cn"
import {
  Drawer as DrawerRoot,
  DrawerBackdrop,
  DrawerClose as DrawerClosePart,
  DrawerContent as DrawerContentPart,
  DrawerDescription as DrawerDescriptionPart,
  DrawerTitle as DrawerTitlePart,
  DrawerTrigger as DrawerTriggerPart,
} from "@ui-sdk/react/drawer"

import {
  resolveAsChild,
  usePopupContainer,
  type AsChildProps,
} from "@/components/ui/overlay-compat"

function Drawer({
  direction,
  ...props
}: React.ComponentProps<typeof DrawerRoot> & {
  direction?: "top" | "right" | "bottom" | "left"
}) {
  return (
    <DrawerRoot
      container={usePopupContainer()}
      {...(direction ? { side: direction } : {})}
      {...props}
    />
  )
}

function DrawerTrigger(
  props: React.ComponentProps<typeof DrawerTriggerPart> & AsChildProps
) {
  return <DrawerTriggerPart {...resolveAsChild(props)} />
}

function DrawerPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function DrawerClose(
  props: React.ComponentProps<typeof DrawerClosePart> & AsChildProps
) {
  return <DrawerClosePart {...resolveAsChild(props)} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerBackdrop>) {
  return (
    <DrawerBackdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DrawerContentPart>, "children"> & {
  children?: React.ReactNode
}) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerContentPart
        className={cn(
          "group/drawer-content z-50 m-0 flex flex-col gap-0 rounded-none border-0 bg-popover p-0 text-sm text-popover-foreground shadow-none data-[side=bottom]:max-h-[80vh] data-[side=bottom]:max-w-none data-[side=bottom]:rounded-t-xl data-[side=bottom]:border-t data-[side=left]:w-3/4 data-[side=left]:rounded-r-xl data-[side=left]:border-r data-[side=right]:w-3/4 data-[side=right]:rounded-l-xl data-[side=right]:border-l data-[side=top]:max-h-[80vh] data-[side=top]:max-w-none data-[side=top]:rounded-b-xl data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
          className
        )}
        {...props}
      >
        <div className="mx-auto mt-4 hidden h-1.5 w-[100px] shrink-0 rounded-full bg-muted group-data-[side=bottom]/drawer-content:block" />
        {children}
      </DrawerContentPart>
    </DrawerPortal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[side=bottom]/drawer-content:text-center group-data-[side=top]/drawer-content:text-center md:gap-1.5 md:text-left",
        className
      )}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerTitlePart>) {
  return (
    <DrawerTitlePart
      className={cn("m-0 font-heading font-medium text-foreground", className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerDescriptionPart>) {
  return (
    <DrawerDescriptionPart
      className={cn("m-0 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
