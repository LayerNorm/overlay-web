import { ChevronDown } from 'lucide-react'

import { ToolLogoColumn } from './tool-rail'

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
 * The row a settled assistant turn shows at the top when it did any work —
 * tool calls, reasoning beats, browser sessions all fold behind it so the
 * collapsed reply is just the text. It is a mode toggle, not a container:
 * expanding switches the whole message to the raw timeline with every work
 * segment back at its true position, and the row stays as the way back.
 */
export function WorkedForGroup({
  durationMs,
  toolCallCount = 0,
  expanded,
  onToggle,
}: {
  /** Measured turn time; absent on reloaded messages, which read "Worked". */
  durationMs?: number | null
  /** Collapsed tool-call count — appended as "— N tool calls" when nonzero. */
  toolCallCount?: number
  expanded: boolean
  onToggle: () => void
}) {
  const label =
    (durationMs != null ? `Worked for ${formatWorkDuration(durationMs)}` : 'Worked') +
    (toolCallCount > 0 ? `, called ${toolCallCount} tool${toolCallCount === 1 ? '' : 's'}` : '')

  return (
    <div className="w-full px-1 py-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="inline-flex h-auto w-fit max-w-full items-stretch gap-2.5 rounded-md px-0 py-1 text-left text-[13px] leading-snug text-[var(--tool-line-label)] hover:bg-transparent"
      >
        <ToolLogoColumn connectTop={false} connectBottom={false} />
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="min-w-0">{label}</span>
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            className={`shrink-0 text-[var(--tool-line-chevron)] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </span>
      </button>
    </div>
  )
}
