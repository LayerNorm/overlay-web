import { OverlayMark } from '@/components/orb/Orb'

/**
 * The Overlay mark, sized in `em` so it follows the font size of its lockup.
 * (The landing stylesheet stretches the real `OverlayMark` SVG to the wrapper.)
 * Always the inline SVG mark, never a raster logo.
 */
export function LandingOrb() {
  return (
    <span className="orb" aria-hidden="true">
      <OverlayMark size={64} label="" />
    </span>
  )
}

/** Orb + serif wordmark, the canonical Overlay lockup. */
export function LandingLockup({ className = '' }: { className?: string }) {
  return (
    <span className={`lockup ${className}`.trim()}>
      <LandingOrb />
      overlay
    </span>
  )
}
