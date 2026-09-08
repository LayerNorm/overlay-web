'use client'

/**
 * Anthropomorphic agent avatars: solid-color creature bodies with Grokbot-style
 * eyes. Pure SVG, no dependencies. The body shape and color are per-agent
 * identity (`avatarShape` / `avatarColor`); eyes pick dark or light from the
 * body luminance so they read on any colorway.
 *
 * Motion is a periodic blink (transform only, staggered per instance).
 * Lists should pass `animated={false}`.
 */

import {
  WORKSPACE_AGENT_CREATURE_SHAPES,
  type WorkspaceAgentCreatureShape,
} from '@overlay/workspace-contracts'
import {
  creatureEyeColor,
  DEFAULT_CREATURE_SHAPE,
  normalizeCreatureShape,
} from '@/shared/agents/agent-creature'
import styles from './Creature.module.css'

export type CreatureShape = WorkspaceAgentCreatureShape
export const CREATURE_SHAPES = WORKSPACE_AGENT_CREATURE_SHAPES

export type CreatureProps = {
  shape?: CreatureShape | string
  color?: string
  size?: number
  /** Blink every few seconds. Off in lists and reduced-motion contexts. */
  animated?: boolean
  label?: string
}

/** Body geometry per shape in a 0 0 100 100 box. Cloud composites circles. */
function CreatureBody({ shape, fill }: { shape: CreatureShape; fill: string }) {
  switch (shape) {
    case 'blob':
      return <path d="M50 12 C70 12 90 28 89 55 C88 80 70 93 50 93 C30 93 11 80 12 54 C13 29 30 12 50 12 Z" fill={fill} />;
    case 'squircle':
      return <rect x="12" y="14" width="76" height="78" rx="24" fill={fill} />;
    case 'pill':
      return <rect x="8" y="30" width="84" height="48" rx="24" fill={fill} />;
    case 'triangle':
      return <path d="M50 16 L86 82 Q89 90 81 90 L19 90 Q11 90 14 82 Z" fill={fill} stroke={fill} strokeWidth="7" strokeLinejoin="round" />;
    case 'hexagon':
      return <path d="M50 12 L84 31 L84 71 L50 90 L16 71 L16 31 Z" fill={fill} stroke={fill} strokeWidth="7" strokeLinejoin="round" />;
    case 'cloud':
      return (
        <g fill={fill}>
          <circle cx="34" cy="61" r="16" />
          <circle cx="50" cy="49" r="20" />
          <circle cx="67" cy="61" r="16" />
          <rect x="21" y="58" width="59" height="23" rx="11.5" />
        </g>
      );
    case 'droplet':
      return <path d="M50 10 C50 10 79 45 79 64 A29 29 0 1 1 21 64 C21 45 50 10 50 10 Z" fill={fill} />;
    case 'circle':
    default:
      return <circle cx="50" cy="53" r="40" fill={fill} />;
  }
}

function CreatureEyes({ color }: { color: string }) {
  return (
    <g className={styles.eyes} fill={color}>
      <rect x="36" y="45" width="9.5" height="17" rx="4.75" transform="rotate(-11 41 53)" />
      <rect x="54.5" y="45" width="9.5" height="17" rx="4.75" transform="rotate(11 59 53)" />
    </g>
  )
}

export function Creature({
  shape = DEFAULT_CREATURE_SHAPE,
  color = '#71717a',
  size = 32,
  animated = true,
  label = 'Agent',
}: CreatureProps) {
  const resolved = normalizeCreatureShape(shape)
  return (
    <span
      role="img"
      aria-label={label}
      className={animated ? styles.blink : undefined}
      style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0 }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <CreatureBody shape={resolved} fill={color} />
        <CreatureEyes color={creatureEyeColor(color)} />
      </svg>
    </span>
  )
}

/**
 * An agent rendered as its creature: body shape from `avatarShape` (circle
 * when unset or unknown), body color from `avatarColor`.
 */
export function AgentCreature({
  agent,
  size = 32,
  animated = false,
}: {
  agent: { name: string; avatarColor?: string; avatarShape?: string }
  size?: number
  animated?: boolean
}) {
  return (
    <Creature
      shape={agent.avatarShape}
      color={agent.avatarColor ?? '#71717a'}
      size={size}
      animated={animated}
      label={`${agent.name} avatar`}
    />
  )
}
