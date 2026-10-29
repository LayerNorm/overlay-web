import React, { type HTMLAttributes } from 'react'
import { OverlayMark, type OverlayMarkProps } from './OverlayMark'

type BrandLockupProps = HTMLAttributes<HTMLSpanElement> & {
  motion?: OverlayMarkProps['motion']
}

export function BrandLockup({ className = '', motion = 'none', ...rest }: BrandLockupProps) {
  return (
    <span {...rest} role="img" aria-label="Overlay" className={`brand-lockup${className ? ` ${className}` : ''}`}>
      <span className="brand-lockup-mark" aria-hidden="true">
        <OverlayMark motion={motion} label="" />
      </span>
      <span className="brand-lockup-mask" aria-hidden="true">
        <span className="brand-lockup-word">verlay</span>
      </span>
    </span>
  )
}
