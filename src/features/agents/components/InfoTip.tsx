'use client'

import { Info } from 'lucide-react'
import { DelayedTooltip } from '@overlay/ui/overlays'

/**
 * A small info icon after a field label. The explanation lives in the tooltip
 * (and the accessible name) instead of a hint line in the layout.
 */
export function InfoTip({ text }: { text: string }) {
  return (
    <DelayedTooltip label={text} side="top">
      <span
        role="img"
        aria-label={text}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center text-[var(--muted-light)] transition-colors hover:text-[var(--foreground)]"
      >
        <Info size={13} strokeWidth={1.75} />
      </span>
    </DelayedTooltip>
  )
}

/** Field label with an optional info tip. */
export function FieldLabel({ children, info, htmlFor }: { children: string; info?: string; htmlFor?: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-[var(--foreground)]">
      {htmlFor ? <label htmlFor={htmlFor}>{children}</label> : <span>{children}</span>}
      {info ? <InfoTip text={info} /> : null}
    </div>
  )
}
