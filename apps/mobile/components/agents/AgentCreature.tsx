/**
 * Anthropomorphic agent avatars: solid-color creature bodies with straight
 * eyes. react-native-svg port of web `src/components/orb/Creature.tsx` — same
 * 0 0 100 100 geometry, same luminance-based eye color, same theme-adaptive
 * fills. No blink animation on mobile (lists stay static).
 */
import React from 'react'
import { View } from 'react-native'
import Svg, { Circle, G, Path, Rect } from 'react-native-svg'
import type { WorkspaceAgentCreatureShape } from '@overlay/workspace-contracts'
import { useTheme } from '../../hooks/useTheme'
import {
  creatureEyeColor,
  DEFAULT_AGENT_AVATAR_COLOR,
  DEFAULT_CREATURE_SHAPE,
  normalizeCreatureShape,
  themeCreatureFills,
} from '../../lib/agentCreature'

function CreatureBody({ shape, fill }: { shape: WorkspaceAgentCreatureShape; fill: string }) {
  switch (shape) {
    case 'blob':
      return (
        <Path
          d="M50 12 C70 12 90 28 89 55 C88 80 70 93 50 93 C30 93 11 80 12 54 C13 29 30 12 50 12 Z"
          fill={fill}
        />
      )
    case 'squircle':
      return <Rect x="12" y="14" width="76" height="78" rx="24" fill={fill} />
    case 'pill':
      return <Rect x="8" y="30" width="84" height="48" rx="24" fill={fill} />
    case 'triangle':
      return (
        <Path
          d="M50 16 L86 82 Q89 90 81 90 L19 90 Q11 90 14 82 Z"
          fill={fill}
          stroke={fill}
          strokeWidth={7}
          strokeLinejoin="round"
        />
      )
    case 'hexagon':
      return (
        <Path
          d="M50 12 L84 31 L84 71 L50 90 L16 71 L16 31 Z"
          fill={fill}
          stroke={fill}
          strokeWidth={7}
          strokeLinejoin="round"
        />
      )
    case 'cloud':
      return (
        <G fill={fill}>
          <Circle cx="34" cy="61" r="16" />
          <Circle cx="50" cy="49" r="20" />
          <Circle cx="67" cy="61" r="16" />
          <Rect x="21" y="58" width="59" height="23" rx="11.5" />
        </G>
      )
    case 'droplet':
      return (
        <Path
          d="M50 10 C50 10 79 45 79 64 A29 29 0 1 1 21 64 C21 45 50 10 50 10 Z"
          fill={fill}
        />
      )
    case 'circle':
    default:
      return <Circle cx="50" cy="53" r="40" fill={fill} />
  }
}

export function AgentCreature({
  shape = DEFAULT_CREATURE_SHAPE,
  color = DEFAULT_AGENT_AVATAR_COLOR,
  size = 32,
  label = 'Agent',
}: {
  shape?: WorkspaceAgentCreatureShape | string
  color?: string
  size?: number
  label?: string
}): React.ReactElement {
  const { isDark } = useTheme()
  const resolved = normalizeCreatureShape(shape)
  const fills = themeCreatureFills(color)
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <CreatureBody shape={resolved} fill={isDark ? fills.dark : fills.light} />
        <G fill={creatureEyeColor(color)}>
          <Rect x="36" y="45" width="9.5" height="17" rx="4.75" />
          <Rect x="54.5" y="45" width="9.5" height="17" rx="4.75" />
        </G>
      </Svg>
    </View>
  )
}
