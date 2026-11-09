'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { BrandLockup } from '@/components/brand/BrandLockup'
import { createBootEntranceClaim } from './boot-loader-state'

const entrance = createBootEntranceClaim()

export function AppBootLoader({ settled = false }: { settled?: boolean }) {
  const [playsEntrance] = useState(() => !entrance.wasPlayed())
  const [opening, setOpening] = useState(!playsEntrance || settled)

  useLayoutEffect(() => {
    entrance.markPlayed()
  }, [])

  useEffect(() => {
    if (settled || !playsEntrance || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = window.setTimeout(() => setOpening(true), 0)
      return () => window.clearTimeout(timer)
    }
    const timer = window.setTimeout(() => setOpening(true), 2600)
    return () => window.clearTimeout(timer)
  }, [playsEntrance, settled])

  return (
    <div className="flex h-screen items-center justify-center overflow-hidden bg-background text-foreground">
      <div
        className={`flex flex-col items-center${settled || !playsEntrance ? ' app-brand-loader--steady' : ''}`}
      >
        <div className="app-brand-loader" role="status" aria-label="Loading Overlay">
          <BrandLockup className="app-brand-loader-lockup" motion="look" />
        </div>
        <div className="app-brand-loader-wsline mt-[30px] flex items-center text-sm text-muted" role="status" aria-live="polite">
          {opening ? <span className="inline-flex items-center gap-2 app-brand-loader-opening"><Loader2 size={16} className="animate-spin" />Opening Workspace&hellip;</span> : <span className="app-brand-loader-tagline">Your AI Chief of Staff.</span>}
        </div>
      </div>
    </div>
  )
}
