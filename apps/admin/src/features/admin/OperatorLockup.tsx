'use client'

import { OverlayMark } from '@overlay/ui'

/** Canonical lockup: inline SVG mark + serif "overlay" wordmark. */
export function OperatorLockup() {
  return (
    <div className="flex items-center justify-center gap-2">
      <OverlayMark size={10} />
      <span
        className="text-lg font-medium lowercase tracking-tight text-(--foreground)"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        overlay
      </span>
    </div>
  )
}
