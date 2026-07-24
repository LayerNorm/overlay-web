'use client'

import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'

export type UsageMeterTone = 'default' | 'warning' | 'exhausted'

export interface UsageMeterBarProps {
  primaryLabel: ReactNode
  secondaryLabel?: ReactNode
  percent: number
  tone?: UsageMeterTone
  trailingIcon?: ReactNode
  className?: string
}

export function UsageMeterBar({
  primaryLabel,
  secondaryLabel,
  percent,
  tone = 'default',
  trailingIcon,
  className,
}: UsageMeterBarProps) {
  const clamped = Math.min(100, Math.max(0, percent))
  const toneClass =
    tone === 'exhausted' ? 'text-red-500' : tone === 'warning' ? 'text-amber-500' : 'text-[var(--muted-light)]'
  const barClass =
    tone === 'exhausted' ? 'bg-red-400' : tone === 'warning' ? 'bg-amber-400' : 'bg-[var(--foreground)]'

  return (
    <div className={cn('flex flex-col gap-1 text-xs', toneClass, className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="tabular-nums">{primaryLabel}</span>
        {secondaryLabel ? (
          <span className="shrink-0 text-[10px] opacity-70 tabular-nums">{secondaryLabel}</span>
        ) : null}
        {trailingIcon}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-[var(--border)]">
        <div className={cn('h-full rounded-full transition-all', barClass)} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}
