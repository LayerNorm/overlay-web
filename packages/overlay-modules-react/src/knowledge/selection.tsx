'use client'

import { cn } from '@overlay/ui'

export function BulkSelectMarker({ selected, className }: { selected: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'flex h-4 w-4 items-center justify-center rounded-sm border border-(--border)',
        selected ? 'border-(--foreground) bg-(--foreground)' : 'bg-(--surface-elevated)',
        className,
      )}
      aria-hidden
    >
      {selected ? <span className="text-[10px] leading-none text-(--background)">✓</span> : null}
    </span>
  )
}
