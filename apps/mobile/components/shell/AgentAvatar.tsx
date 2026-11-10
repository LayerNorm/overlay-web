import React from 'react'
import Svg, { Circle, G, Path, Rect } from 'react-native-svg'
import {
  creatureEyeColor,
  normalizeCreatureShape,
  themeCreatureFills,
} from '../../../src/shared/agents/agent-creature'
import { OverlayMark } from './Brand'

export function AgentAvatar({
  agent,
  dark,
  foreground,
  size = 25,
}: {
  agent: { name: string; isDefault?: boolean; avatarShape?: string; avatarColor?: string }
  dark: boolean
  foreground: string
  size?: number
}) {
  if (agent.isDefault) return <OverlayMark size={size} color={foreground} />
  const fills = themeCreatureFills(agent.avatarColor ?? '#71717a')
  const fill = dark ? fills.dark : fills.light
  const shape = normalizeCreatureShape(agent.avatarShape)
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel={agent.name}>
      <G fill={fill} stroke={fill} strokeLinejoin="round">
        {shape === 'blob' ? (
          <Path d="M50 12 C70 12 90 28 89 55 C88 80 70 93 50 93 C30 93 11 80 12 54 C13 29 30 12 50 12 Z" />
        ) : shape === 'squircle' ? (
          <Rect x="12" y="14" width="76" height="78" rx="24" />
        ) : shape === 'pill' ? (
          <Rect x="8" y="30" width="84" height="48" rx="24" />
        ) : shape === 'triangle' ? (
          <Path d="M50 16 L86 82 Q89 90 81 90 L19 90 Q11 90 14 82 Z" strokeWidth="7" />
        ) : shape === 'hexagon' ? (
          <Path d="M50 12 L84 31 L84 71 L50 90 L16 71 L16 31 Z" strokeWidth="7" />
        ) : shape === 'droplet' ? (
          <Path d="M50 10 C50 10 79 45 79 64 A29 29 0 1 1 21 64 C21 45 50 10 50 10 Z" />
        ) : shape === 'cloud' ? (
          <>
            <Circle cx="34" cy="61" r="16" />
            <Circle cx="50" cy="49" r="20" />
            <Circle cx="67" cy="61" r="16" />
            <Rect x="21" y="58" width="59" height="23" rx="11.5" />
          </>
        ) : (
          <Circle cx="50" cy="53" r="40" />
        )}
      </G>
      <G fill={creatureEyeColor(fill)}>
        <Rect x="36" y="45" width="9.5" height="17" rx="4.75" />
        <Rect x="54.5" y="45" width="9.5" height="17" rx="4.75" />
      </G>
    </Svg>
  )
}
