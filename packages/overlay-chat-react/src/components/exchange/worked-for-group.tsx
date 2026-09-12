import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

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
 * The single collapsed row a settled assistant turn shows for everything that
 * happened before its final answer — tool calls, reasoning beats, and
 * interstitial text — expanded on click to reveal them in original order.
 */
export function WorkedForGroup({
  durationMs,
  children,
}: {
  /** Measured turn time; absent on reloaded messages, which read "Worked". */
  durationMs?: number | null
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const label = durationMs != null ? `Worked for ${formatWorkDuration(durationMs)}` : 'Worked'

  return (
    <div className="w-full px-1 py-0.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex h-auto w-fit max-w-full items-stretch gap-2.5 rounded-md px-0 py-1 text-left text-[13px] leading-snug text-[var(--tool-line-label)] hover:bg-transparent"
      >
        <ToolLogoColumn connectTop={false} connectBottom={false} />
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="min-w-0">{label}</span>
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            className={`shrink-0 text-[var(--tool-line-chevron)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </span>
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  )
}
