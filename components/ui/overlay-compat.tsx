import * as React from "react"

type AsChildProps = { asChild?: boolean }

const subscribe = () => () => {}

// ui-sdk popups render in place; mounting on body keeps ancestor selectors like `*:w-full` or text colors off them.
export function usePopupContainer(): HTMLElement | null {
  return React.useSyncExternalStore(
    subscribe,
    () => document.body,
    () => null
  )
}

export function resolveAsChild<P extends { children?: unknown }>({
  asChild,
  ...props
}: P & AsChildProps): P {
  const child = props.children
  if (!asChild || !React.isValidElement<{ children?: React.ReactNode }>(child)) {
    return props as unknown as P
  }
  return {
    ...props,
    render: child,
    children: child.props.children,
  } as unknown as P
}

export type { AsChildProps }
