'use client'

import { useEffect, useState } from 'react'
import { BrandLockup } from '@/components/brand/BrandLockup'
import styles from './onboarding.module.css'

/** A short welcome before the conversation; skipped for reduced motion. */
export function OnboardingIntro({ onDone }: { onDone(): void }) {
  const [out, setOut] = useState(false)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onDone(); return }
    const timers = [window.setTimeout(() => setOut(true), 1700), window.setTimeout(onDone, 2200)]
    return () => timers.forEach(window.clearTimeout)
  }, [onDone])
  return (
    <div className={styles.intro} data-out={out} aria-hidden={out}>
      <div className="text-center">
        <BrandLockup className={styles.introLockup} />
        <p className={styles.introLine}>Your AI chief of staff.</p>
      </div>
    </div>
  )
}
