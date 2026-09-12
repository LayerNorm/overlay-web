import {
  WORKSPACE_AGENT_CREATURE_SHAPES,
  type WorkspaceAgentCreatureShape,
} from '@overlay/workspace-contracts'

export const DEFAULT_CREATURE_SHAPE: WorkspaceAgentCreatureShape = 'circle'

type RGB = { r: number; g: number; b: number }

export function hexToRgb(hex: string): RGB | null {
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

function luminance({ r, g, b }: RGB): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** Dark eyes on light bodies, near-white eyes on dark bodies. */
export function creatureEyeColor(bodyColor: string): string {
  const rgb = hexToRgb(bodyColor)
  if (!rgb) return '#1c1917'
  return luminance(rgb) > 0.5 ? '#1c1917' : '#fafaf9'
}

function toHex({ r, g, b }: RGB): string {
  const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

const WHITE: RGB = { r: 255, g: 255, b: 255 }
const BLACK: RGB = { r: 0, g: 0, b: 0 }

/**
 * Theme-adaptive body fills so creatures read on both themes: very dark
 * bodies lift toward grey in dark mode, very light bodies deepen in light
 * mode. Mid-tone colors render identically in both.
 */
export function themeCreatureFills(bodyColor: string): { light: string; dark: string } {
  const rgb = hexToRgb(bodyColor)
  if (!rgb) return { light: bodyColor, dark: bodyColor }
  const lum = luminance(rgb)
  return {
    light: lum > 0.78 ? toHex(mix(rgb, BLACK, 0.28)) : bodyColor,
    dark: lum < 0.32 ? toHex(mix(rgb, WHITE, 0.5)) : bodyColor,
  }
}

/** Unknown or absent shapes fall back to the circle body. */
export function normalizeCreatureShape(shape: string | undefined): WorkspaceAgentCreatureShape {
  return (WORKSPACE_AGENT_CREATURE_SHAPES as readonly string[]).includes(shape ?? '')
    ? (shape as WorkspaceAgentCreatureShape)
    : DEFAULT_CREATURE_SHAPE
}
