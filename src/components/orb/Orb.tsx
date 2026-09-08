'use client'

/**
 * Parameterized orb renderer for the Overlay chrome mark. Pure SVG + CSS, no
 * WebGL, no new dependencies. Agent avatars live in `./Creature`.
 */

import { useId } from 'react'
import styles from './Orb.module.css'

export type OrbState = 'idle' | 'working' | 'waiting' | 'offline'
export type OrbVariant = 'metal' | 'glow'

export type OrbProps = {
  variant?: OrbVariant
  /** Base hex color for the `glow` variant (e.g. an agent's avatarColor). */
  color?: string
  /** Diameter in px. The SVG scales losslessly. */
  size?: number
  state?: OrbState
  /** False freezes the orb (for lists and reduced-motion contexts). */
  animated?: boolean
  /** Soft outer colored halo (glow variant only). */
  glow?: boolean
  label?: string
  /** Reserved 0..1 input for future voice reactivity. No visual effect yet. */
  volume?: number
}

export const OVERLAY_ORB_DEFAULT_COLOR = '#71717a'

type RGB = { r: number; g: number; b: number }

function hexToRgb(hex: string): RGB | null {
  const normalized = hex.trim().replace(/^#/, '')
  const full = normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  }
}

function css(c: RGB, alpha = 1): string {
  return alpha >= 1 ? `rgb(${c.r} ${c.g} ${c.b})` : `rgb(${c.r} ${c.g} ${c.b} / ${alpha})`
}

const WHITE: RGB = { r: 255, g: 255, b: 255 }
const BLACK: RGB = { r: 0, g: 0, b: 0 }

function glowPalette(base: string) {
  const mid = hexToRgb(base) ?? hexToRgb(OVERLAY_ORB_DEFAULT_COLOR)!
  return {
    hi: css(mix(mid, WHITE, 0.88)),
    light: css(mix(mid, WHITE, 0.52)),
    mid: css(mid),
    dark: css(mix(mid, BLACK, 0.42)),
    deep: css(mix(mid, BLACK, 0.72)),
    halo: css(mid, 0.45),
  }
}

const METAL = {
  hi: '#ffffff',
  light: '#eceef1',
  mid: '#a8adb5',
  dark: '#4c5158',
  deep: '#17191d',
}

const STATE_CLASS: Record<OrbState, string> = {
  idle: styles.drift,
  working: styles.spin,
  waiting: styles.breathe,
  offline: '',
}

export function Orb({
  variant = 'glow',
  color = OVERLAY_ORB_DEFAULT_COLOR,
  size = 32,
  state = 'idle',
  animated = true,
  glow = false,
  label,
}: OrbProps) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const p = variant === 'metal' ? METAL : glowPalette(color)
  const motion = !animated || state === 'offline' ? '' : STATE_CLASS[state]
  const dimmed = state === 'offline' ? styles.dim : ''

  return (
    <span
      role="img"
      aria-label={label ?? (variant === 'metal' ? 'Overlay' : 'Agent orb')}
      className={`${styles.root} ${motion} ${dimmed}`}
      style={{
        width: size,
        height: size,
        filter: glow && variant === 'glow' && state !== 'offline'
          ? `drop-shadow(0 0 ${Math.max(6, size / 4)}px ${glowPalette(color).halo})`
          : undefined,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <radialGradient id={`${rawId}-body`} cx="38%" cy="28%" r="78%">
            <stop offset="0%" stopColor={p.hi} />
            <stop offset="22%" stopColor={p.light} />
            <stop offset="46%" stopColor={p.mid} />
            <stop offset="72%" stopColor={p.dark} />
            <stop offset="100%" stopColor={p.deep} />
          </radialGradient>
          <linearGradient id={`${rawId}-rim`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="52%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="80%" stopColor="#ffffff" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <filter id={`${rawId}-soft6`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <filter id={`${rawId}-soft2`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
          <filter id={`${rawId}-soft14`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          <clipPath id={`${rawId}-clip`}>
            <circle cx="100" cy="100" r="96" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${rawId}-clip)`}>
          <circle cx="100" cy="100" r="96" fill={`url(#${rawId}-body)`} />
          <ellipse cx="138" cy="142" rx="44" ry="34" fill="#000000" opacity="0.22" filter={`url(#${rawId}-soft14)`} />
          <ellipse cx="80" cy="72" rx="54" ry="42" fill="#ffffff" opacity="0.26" filter={`url(#${rawId}-soft14)`} transform="rotate(-20 80 72)" />
          <circle cx="100" cy="100" r="88" fill="none" stroke={`url(#${rawId}-rim)`} strokeWidth="7" filter={`url(#${rawId}-soft6)`} />
          <ellipse cx="100" cy="168" rx="54" ry="13" fill="#ffffff" opacity="0.3" filter={`url(#${rawId}-soft6)`} />
          <ellipse cx="73" cy="59" rx="27" ry="17" fill="#ffffff" opacity="0.9" filter={`url(#${rawId}-soft6)`} transform="rotate(-24 73 59)" />
          <ellipse cx="67" cy="51" rx="10" ry="7" fill="#ffffff" opacity="0.95" filter={`url(#${rawId}-soft2)`} transform="rotate(-24 67 51)" />
        </g>
      </svg>
      <span className={styles.sheen} aria-hidden="true" />
    </span>
  )
}

/** The Overlay chrome mark: grey metallic orb at any size. */
export function OverlayMark({ size = 20, label = 'Overlay' }: { size?: number; label?: string }) {
  return <Orb variant="metal" size={size} state="idle" animated={false} label={label} />
}
