import type { HTMLAttributes } from 'react'
import { OverlayMark } from '@/components/orb/Orb'

/**
 * The canonical Overlay lockup: the orb mark resting on the text baseline of a
 * lowercase serif "overlay" wordmark. Everything scales off `font-size` — the
 * orb is 0.5em and the gap 0.4em — so set the size via `style`/`className` font
 * size or an ancestor's font size.
 *
 * The word sits inside `.brand-lockup-mask`, an overflow-hidden window padded
 * just enough to keep the "y" descender unclipped; the boot loader's reveal
 * animation slides the word out from behind the orb through it.
 *
 * Always renders the inline SVG `OverlayMark`, never a raster logo.
 */
export function BrandLockup({ className = '', ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...rest} className={`brand-lockup${className ? ` ${className}` : ''}`}>
      <span className="brand-lockup-orb" aria-hidden="true">
        <OverlayMark size={64} label="" />
      </span>
      <span className="brand-lockup-mask">
        <span className="brand-lockup-word">overlay</span>
      </span>
    </span>
  )
}
