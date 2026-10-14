'use client'

import { OverlayMark } from '@overlay/ui'

export function AdminLogo({ size = 10 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <OverlayMark size={size} label="Overlay" />
      <span className="font-serif text-xl font-medium tracking-tight text-(--foreground)">overlay</span>
    </span>
  )
}
