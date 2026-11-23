"use client"

import * as React from "react"
import { cn } from "cn"
import {
  Dialog as SheetRoot,
  DialogBackdrop,
  DialogClose as SheetClosePart,
  DialogContent as SheetContentPart,
  DialogDescription as SheetDescriptionPart,
  DialogTitle as SheetTitlePart,
  DialogTrigger as SheetTriggerPart,
} from "@ui-sdk/react/dialog"

import { Button } from "@/components/ui/button"
import {
  resolveAsChild,
  usePopupContainer,
  type AsChildProps,
} from "@/components/ui/overlay-compat"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: React.ComponentProps<typeof SheetRoot>) {
  return <SheetRoot container={usePopupContainer()} {...props} />
}

function SheetTrigger(
  props: React.ComponentProps<typeof SheetTriggerPart> & AsChildProps
) {
  return <SheetTriggerPart {...resolveAsChild(props)} />
}

function SheetClose(
  props: React.ComponentProps<typeof SheetClosePart> & AsChildProps
) {
  return <SheetClosePart {...resolveAsChild(props)} />
}

function SheetPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogBackdrop>) {
  return (
    <DialogBackdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-ending-style:animate-out data-ending-style:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: Omit<React.ComponentProps<typeof SheetContentPart>, "children"> & {
  children?: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetContentPart
        data-side={side}
        className={cn(
          "fixed z-50 m-0 flex max-h-none flex-col gap-4 overflow-visible rounded-none border-0 bg-popover bg-clip-padding p-0 text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out outline-none data-[side=bottom]:inset-x-0 data-[side=bottom]:top-auto data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:w-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:right-auto data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:left-auto data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:bottom-auto data-[side=top]:h-auto data-[side=top]:w-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-ending-style:animate-out data-ending-style:fade-out-0 data-[side=bottom]:data-ending-style:slide-out-to-bottom-10 data-[side=left]:data-ending-style:slide-out-to-left-10 data-[side=right]:data-ending-style:slide-out-to-right-10 data-[side=top]:data-ending-style:slide-out-to-top-10",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetClosePart
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </SheetClosePart>
        )}
      </SheetContentPart>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetTitlePart>) {
  return (
    <SheetTitlePart
      className={cn("m-0 font-heading text-sm font-medium text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetDescriptionPart>) {
  return (
    <SheetDescriptionPart
      className={cn("m-0 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
