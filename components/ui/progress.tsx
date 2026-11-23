"use client"

import * as React from "react"
import { cn } from "cn"
import {
  Progress as ProgressPrimitive,
  ProgressIndicator,
  ProgressTrack,
} from "@ui-sdk/react/progress"

function Progress({
  className,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive>) {
  return (
    <ProgressPrimitive
      data-slot="progress"
      className={cn(
        "relative flex h-1.5 w-full min-w-0 items-center overflow-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      <ProgressTrack className="h-full flex-1 rounded-none bg-transparent">
        <ProgressIndicator
          data-slot="progress-indicator"
          className="bg-primary transition-all"
        />
      </ProgressTrack>
    </ProgressPrimitive>
  )
}

export { Progress }
