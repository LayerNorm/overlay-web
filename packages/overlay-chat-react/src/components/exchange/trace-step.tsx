import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from '@overlay/ui/ai'
import type { ReactNode } from 'react'

import { TraceMark } from './tool-rail'

/** One work step: a title, plus details behind a collapsible trigger when there are any. */
export function TraceStep({
  label,
  running,
  error = false,
  open = false,
  onOpenChange,
  expandLabel,
  children,
}: {
  label: ReactNode
  running: boolean
  error?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  expandLabel?: string
  children?: ReactNode
}) {
  const line = (
    <TraceLine status={running ? 'running' : error ? 'error' : undefined}>
      <TraceMark running={running} />
      <TraceTitle className="whitespace-normal">{label}</TraceTitle>
    </TraceLine>
  )
  if (!children) {
    return <Trace className="max-w-[min(100%,36rem)] px-1 py-1 text-[13px] leading-snug">{line}</Trace>
  }
  return (
    <Trace className="max-w-[min(100%,36rem)] px-1 py-0.5">
      <TraceCollapsible open={open} onOpenChange={onOpenChange ?? (() => {})}>
        <TraceCollapsibleTrigger className="py-1 text-[13px] leading-snug" aria-label={expandLabel}>
          {line}
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>{children}</TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
