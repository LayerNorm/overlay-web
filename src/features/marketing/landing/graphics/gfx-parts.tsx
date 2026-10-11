import type { CSSProperties } from 'react'
import { Creature, type CreatureShape } from '@/components/orb/Creature'

/** Shared pieces for the scene graphics. */

export const AMBER = '#f59e0b'

/** Style helper that allows CSS custom properties (`--c`) in a typed style object. */
export const sv = (style: Record<string, string | number>): CSSProperties => style as CSSProperties

/** A creature at a fixed pixel size, optionally bobbing. */
export function Cr({
  shape,
  color,
  size,
  bob = false,
}: {
  shape: CreatureShape
  color: string
  size: number
  bob?: boolean
}) {
  return (
    <div className={bob ? 'cr bob' : 'cr'} style={{ width: size, height: size }}>
      <Creature shape={shape} color={color} size={size} animated={bob} />
    </div>
  )
}

const PATHS = {
  memory: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2',
  tools: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM7 11V7a5 5 0 0 1 10 0v4',
  file: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4',
  check: 'M20 6 9 17l-5-5',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 6v6l4 2',
  zap: 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  computer: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 21h8M12 17v4',
  database: 'M21 5c0 1.66-4.03 3-9 3S3 6.66 3 5s4.03-3 9-3 9 1.34 9 3ZM3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3',
} as const

export type GfxIcon = keyof typeof PATHS

/** A thin Lucide-style stroke icon. */
export function Gi({ name, size = 20 }: { name: GfxIcon; size?: number }) {
  return (
    <svg className="g" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
