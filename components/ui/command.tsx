"use client"

import * as React from "react"
import { cn } from "cn"
import {
  Command as CommandPrimitive,
  CommandEmpty as CommandEmptyPrimitive,
  CommandGroup as CommandGroupPrimitive,
  CommandGroupLabel as CommandGroupLabelPrimitive,
  CommandInput as CommandInputPrimitive,
  CommandItem as CommandItemPrimitive,
  CommandList as CommandListPrimitive,
  CommandSeparator as CommandSeparatorPrimitive,
} from "@ui-sdk/react/command"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
} from "@/components/ui/input-group"
import { SearchIcon } from "lucide-react"

type InputBridge = {
  registerHandler: (fn: ((value: string) => void) | undefined) => void
  setQuery: (value: string) => void
}

const InputBridgeContext = React.createContext<InputBridge | null>(null)

function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join("")
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return nodeText(node.props.children)
  }
  return ""
}

function Command({
  className,
  shouldFilter = true,
  filter,
  ...props
}: Omit<
  React.ComponentProps<typeof CommandPrimitive>,
  "query" | "defaultQuery" | "onQueryChange"
> & { shouldFilter?: boolean }) {
  const [query, setQuery] = React.useState("")
  const handler = React.useRef<((value: string) => void) | undefined>(undefined)
  const bridge = React.useMemo<InputBridge>(
    () => ({
      registerHandler: (fn) => {
        handler.current = fn
      },
      setQuery,
    }),
    []
  )
  return (
    <InputBridgeContext.Provider value={bridge}>
      <CommandPrimitive
        data-slot="command"
        filter={shouldFilter ? filter : false}
        query={query}
        onQueryChange={(next) => {
          setQuery(next)
          handler.current?.(next)
        }}
        className={cn(
          "flex size-full flex-col overflow-hidden rounded-xl! border-0 bg-popover p-1 text-popover-foreground",
          className
        )}
        {...props}
      />
    </InputBridgeContext.Provider>
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0",
          className
        )}
        showCloseButton={showCloseButton}
      >
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  value,
  onValueChange,
  ...props
}: Omit<
  React.ComponentProps<typeof CommandInputPrimitive>,
  "value" | "defaultValue" | "onChange"
> & {
  value?: string
  onValueChange?: (value: string) => void
}) {
  const bridge = React.useContext(InputBridgeContext)
  const registerHandler = bridge?.registerHandler
  const setQuery = bridge?.setQuery

  React.useEffect(() => {
    registerHandler?.(onValueChange)
    return () => registerHandler?.(undefined)
  }, [registerHandler, onValueChange])

  React.useEffect(() => {
    if (value !== undefined) setQuery?.(value)
  }, [value, setQuery])

  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <InputGroup className="h-8! rounded-lg! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-2!">
        <CommandInputPrimitive
          data-slot="command-input"
          className={cn(
            "h-auto w-full border-0 bg-transparent text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandListPrimitive>) {
  return (
    <CommandListPrimitive
      data-slot="command-list"
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandEmptyPrimitive>) {
  return (
    <CommandEmptyPrimitive
      data-slot="command-empty"
      className={cn("py-6 text-center text-sm", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  heading,
  children,
  ...props
}: Omit<React.ComponentProps<typeof CommandGroupPrimitive>, "children"> & {
  heading?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <CommandGroupPrimitive
      data-slot="command-group"
      className={cn("overflow-hidden p-1 text-foreground", className)}
      {...props}
    >
      {heading != null && (
        <CommandGroupLabelPrimitive
          data-slot="command-group-label"
          className="px-2 py-1.5 text-xs font-medium text-muted-foreground"
        >
          {heading}
        </CommandGroupLabelPrimitive>
      )}
      {children}
    </CommandGroupPrimitive>
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandSeparatorPrimitive>) {
  return (
    <CommandSeparatorPrimitive
      data-slot="command-separator"
      className={cn("-mx-1 h-px w-auto bg-border", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  value,
  label,
  onSelect,
  ...props
}: Omit<
  React.ComponentProps<typeof CommandItemPrimitive>,
  "children" | "onSelect"
> & {
  children?: React.ReactNode
  onSelect?: (value: string) => void
}) {
  return (
    <CommandItemPrimitive
      data-slot="command-item"
      value={value}
      label={label ?? (nodeText(children).trim() || value)}
      onSelect={onSelect ? () => onSelect(value ?? "") : undefined}
      className={cn(
        "group/command-item relative flex min-h-0 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg! data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted data-highlighted:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-highlighted:**:[svg]:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </CommandItemPrimitive>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-data-highlighted/command-item:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
