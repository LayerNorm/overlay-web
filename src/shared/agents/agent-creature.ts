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

/** Unknown or absent shapes fall back to the circle body. */
export function normalizeCreatureShape(shape: string | undefined): WorkspaceAgentCreatureShape {
  return (WORKSPACE_AGENT_CREATURE_SHAPES as readonly string[]).includes(shape ?? '')
    ? (shape as WorkspaceAgentCreatureShape)
    : DEFAULT_CREATURE_SHAPE
}
