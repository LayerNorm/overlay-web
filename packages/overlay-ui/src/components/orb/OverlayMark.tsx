import React from 'react'
import { cn } from '../../utils/cn'
import { ApprovedBrandIcon } from './ApprovedBrand'

export type OverlayMarkProps = {
  size?: number
  motion?: 'none' | 'blink' | 'look'
  label?: string
  className?: string
}

export function OverlayMark({ size = 20, motion = 'none', label = 'Overlay', className }: OverlayMarkProps) {
  const decorative = label === ''
  return <ApprovedBrandIcon
    width={size} height={size} motion={motion}
    role={decorative ? undefined : 'img'}
    aria-label={decorative ? undefined : label}
    aria-hidden={decorative || undefined}
    className={cn('overlay-mark', `overlay-mark--${motion}`, className)}
  />
}
