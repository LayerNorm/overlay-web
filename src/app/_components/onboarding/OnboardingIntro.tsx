'use client'

import { useEffect, useState, type RefObject } from 'react'
import { Button } from '@overlay/ui/primitives'
import { OverlayMark } from '@/components/orb/Orb'
import { AgentCreature } from '@/components/orb/Creature'
import styles from './onboarding.module.css'

export function OnboardingIntro({ target, onDone }: { target: RefObject<HTMLDivElement | null>; onDone(): void }) {
  const [phase, setPhase] = useState(0)
  const [dock, setDock] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onDone(); return }
    const timers = [
      window.setTimeout(() => setPhase(1), 650),
      window.setTimeout(() => setPhase(2), 1800),
      window.setTimeout(() => setPhase(3), 2650),
      window.setTimeout(() => {
        const heading = target.current?.querySelector('header')
        const bounds = heading?.getBoundingClientRect()
        setDock({ x: (bounds?.left ?? 0) + 36 - window.innerWidth / 2, y: (bounds?.top ?? 0) + 32 - window.innerHeight * 0.38 })
        setPhase(4)
      }, 3550),
      window.setTimeout(onDone, 4250),
    ]
    return () => timers.forEach(window.clearTimeout)
  }, [onDone, target])
  return (
    <div className={styles.intro} data-docking={phase === 4}>
      <Button variant="ghost" size="sm" onClick={onDone} className="absolute right-5 top-5 text-muted-foreground">Skip intro</Button>
      <div className={styles.identity} style={phase === 4 ? { transform: `translate(${dock.x}px, ${dock.y}px) scale(.32)` } : undefined}>
        <div className={styles.orb} data-hidden={phase >= 2}><OverlayMark size={100} /></div>
        <div className={styles.creature} data-visible={phase >= 2}><AgentCreature agent={{ name: 'Overlay' }} size={100} /></div>
      </div>
      <div className={styles.introCopy} data-hidden={phase === 4} aria-live="polite">
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{phase < 2 ? 'Welcome to Overlay' : 'Meet Overlay'}</h1>
        <p className={styles.subtitle} data-visible={phase === 1 || phase >= 3}>
          {phase < 2 ? 'Manage and collaborate with your AI employees from a single place.' : 'Your new AI chief of staff.'}
        </p>
      </div>
    </div>
  )
}
