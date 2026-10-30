import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@overlay/ui/ai'
import { ChevronRight } from 'lucide-react'

import { TraceMark } from './tool-rail'

/** "Worked for 12s" / "Worked for 1m 5s" — the settled-turn label. */
export function formatWorkDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 1) return '<1s'
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

/**
 * The row a settled assistant turn shows at the top when it did any work.
 * It is a mode toggle, not a container: expanding switches the whole message
 * to the raw timeline with every work segment back at its true position.
 */
export function WorkedForGroup({
  durationMs,
  toolCallCount = 0,
  expanded,
  onToggle,
}: {
  /** Measured turn time; absent on reloaded messages, which read "Worked". */
  durationMs?: number | null
  toolCallCount?: number
  expanded: boolean
  onToggle: () => void
}) {
  const label =
    (durationMs != null ? `Worked for ${formatWorkDuration(durationMs)}` : 'Worked') +
    (toolCallCount > 0 ? `, called ${toolCallCount} tool${toolCallCount === 1 ? '' : 's'}` : '')

  return (
    <Trace className="px-1 py-0.5">
      <Button
        variant="ghost"
        onClick={onToggle}
        aria-expanded={expanded}
        className={unstyledButton('h-auto w-fit max-w-full rounded-lg p-0 py-1 text-[13px] leading-snug hover:bg-transparent')}
      >
        <TraceLine>
          <TraceMark />
          <TraceTitle>{label}</TraceTitle>
          <TraceIcon className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>
            <ChevronRight />
          </TraceIcon>
        </TraceLine>
      </Button>
    </Trace>
  )
}
