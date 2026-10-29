'use client'

import { useLayoutEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { BrandLockup } from '@/components/brand/BrandLockup'
import { createBootEntranceClaim } from './boot-loader-state'

const entrance = createBootEntranceClaim()

export function AppBootLoader({ settled = false }: { settled?: boolean }) {
  const [playsEntrance] = useState(() => !entrance.wasPlayed())

  useLayoutEffect(() => {
    entrance.markPlayed()
  }, [])

  return (
    <div className="flex h-screen items-center justify-center overflow-hidden bg-background text-foreground">
      <div
        className={`flex flex-col items-center${settled || !playsEntrance ? ' app-brand-loader--steady' : ''}`}
      >
        <div className="app-brand-loader" role="status" aria-label="Loading Overlay">
          <BrandLockup className="app-brand-loader-lockup" motion="look" />
        </div>
        <div className="app-brand-loader-wsline mt-[30px] flex items-center text-sm text-muted">
          <Loader2 size={16} className="mr-2 animate-spin" />
          <span>Opening workspace&hellip;</span>
        </div>
      </div>
    </div>
  )
}
