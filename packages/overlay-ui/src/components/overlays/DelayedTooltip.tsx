'use client'

import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { cn } from '../../utils/cn'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

function supportsHoverTooltip() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  )
}

/**
 * Tooltip with delayed show, rendered in a Radix portal so parent
 * overflow/sidebars cannot clip it. API kept identical to the previous
 * hand-rolled implementation.
 */
export function DelayedTooltip({
  label,
  children,
  className = '',
  side = 'top',
}: {
  label: string
  children: ReactNode
  className?: string
  side?: 'top' | 'bottom' | 'left'
}) {
  // Server snapshot is always `false`, so SSR and the first client render
  // agree (avoids hydration mismatch); the real check runs after mount.
  const hoverable = useSyncExternalStore(
    () => () => {},
    () => supportsHoverTooltip(),
    () => false,
  )

  if (!hoverable) {
    return <span className={cn('relative inline-flex', className)}>{children}</span>
  }
  return (
    <TooltipProvider delayDuration={450}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('relative inline-flex', className)}>{children}</span>
        </TooltipTrigger>
        <TooltipContent side={side} className="pointer-events-none">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
