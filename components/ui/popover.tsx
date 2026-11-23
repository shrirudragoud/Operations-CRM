"use client"

import * as React from "react"
import { cn } from "cn"
import {
  Popover as PopoverRoot,
  PopoverContent as PopoverContentPart,
  PopoverDescription as PopoverDescriptionPart,
  PopoverTitle as PopoverTitlePart,
  PopoverTrigger as PopoverTriggerPart,
} from "@ui-sdk/react/popover"

import {
  resolveAsChild,
  usePopupContainer,
  type AsChildProps,
} from "@/components/ui/overlay-compat"

const PopoverAnchorContext = React.createContext<{
  anchor: HTMLElement | null
  setAnchor: (element: HTMLElement | null) => void
} | null>(null)

function Popover({ ...props }: React.ComponentProps<typeof PopoverRoot>) {
  const container = usePopupContainer()
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null)
  const value = React.useMemo(() => ({ anchor, setAnchor }), [anchor])
  return (
    <PopoverAnchorContext.Provider value={value}>
      <PopoverRoot container={container} {...props} />
    </PopoverAnchorContext.Provider>
  )
}

function PopoverTrigger(
  props: React.ComponentProps<typeof PopoverTriggerPart> & AsChildProps
) {
  return <PopoverTriggerPart {...resolveAsChild(props)} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  anchor,
  ...props
}: React.ComponentProps<typeof PopoverContentPart>) {
  const registered = React.useContext(PopoverAnchorContext)?.anchor ?? null
  return (
    <PopoverContentPart
      align={align}
      sideOffset={sideOffset}
      anchor={anchor ?? registered ?? undefined}
      className={cn(
        "z-50 flex w-72 max-w-none min-w-0 origin-(--transform-origin) flex-col gap-4 rounded-md border-0 bg-popover p-4 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-ending-style:animate-out data-ending-style:fade-out-0 data-ending-style:zoom-out-95",
        className
      )}
      {...props}
    />
  )
}

function PopoverAnchor({
  asChild,
  children,
  ...props
}: React.ComponentProps<"div"> & AsChildProps) {
  const setAnchor = React.useContext(PopoverAnchorContext)?.setAnchor
  const ref = React.useCallback(
    (element: HTMLElement | null) => setAnchor?.(element),
    [setAnchor]
  )
  if (asChild && React.isValidElement<{ ref?: React.Ref<HTMLElement> }>(children)) {
    return React.cloneElement(children, { ...props, ref } as object)
  }
  return (
    <div data-slot="popover-anchor" ref={ref} {...props}>
      {children}
    </div>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({
  className,
  ...props
}: React.ComponentProps<typeof PopoverTitlePart>) {
  return (
    <PopoverTitlePart
      className={cn("m-0 text-sm font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<typeof PopoverDescriptionPart>) {
  return (
    <PopoverDescriptionPart
      className={cn("m-0 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
