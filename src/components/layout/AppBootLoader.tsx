'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { BrandLockup } from '@/components/brand/BrandLockup'
import { createBootEntranceClaim, createBootLoaderPulseClock } from './boot-loader-pulse'

const synchronizePulse = createBootLoaderPulseClock()
const entrance = createBootEntranceClaim()

/**
 * Unified app boot loader: the canonical brand lockup appears once (mark fades
 * in, word reveals from behind it), then the whole lockup breathes like the
 * chat stream marker, with the "Opening workspace…" line beneath on the same
 * screen.
 *
 * The entrance is a one-time thing per app boot: the first loader to mount
 * plays it, and every later gate renders `settled` (entrance pre-played) so the
 * word never re-reveals and the lockup just keeps blinking. The pulse phase is
 * also preserved across boundary handoffs.
 */
export function AppBootLoader({ settled = false }: { settled?: boolean }) {
  const pulseRef = useRef<HTMLDivElement>(null)
  const [playsEntrance] = useState(() => !entrance.wasPlayed())

  useLayoutEffect(() => {
    entrance.markPlayed()
    const pulse = pulseRef.current
    const now = pulse?.ownerDocument.timeline.currentTime
    const animation = pulse?.getAnimations()[0]
    if (animation && typeof now === 'number') synchronizePulse(animation, now)
  }, [])

  return (
    <div className="flex h-screen items-center justify-center overflow-hidden bg-background text-foreground">
      <div
        className={`flex flex-col items-center${settled || !playsEntrance ? ' app-brand-loader--steady' : ''}`}
      >
        <div ref={pulseRef} className="app-brand-loader-pulse">
          <div className="app-brand-loader" role="status" aria-label="Loading overlay">
            <BrandLockup className="app-brand-loader-lockup" />
          </div>
        </div>
        <div className="app-brand-loader-wsline mt-[30px] flex items-center text-sm text-muted">
          <Loader2 size={16} className="mr-2 animate-spin" />
          <span>Opening workspace&hellip;</span>
        </div>
      </div>
    </div>
  )
}
