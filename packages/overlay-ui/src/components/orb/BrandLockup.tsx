import React, { type HTMLAttributes } from 'react'
import { ApprovedBrandWordmark } from './ApprovedBrand'
import type { OverlayMarkProps } from './OverlayMark'

type BrandLockupProps = HTMLAttributes<HTMLSpanElement> & {
  motion?: OverlayMarkProps['motion']
}

export function BrandLockup({ className = '', motion = 'none', ...rest }: BrandLockupProps) {
  return (
    <span {...rest} className={`brand-lockup${className ? ` ${className}` : ''}`}>
      <ApprovedBrandWordmark role="img" aria-label="Overlay" motion={motion} />
    </span>
  )
}
