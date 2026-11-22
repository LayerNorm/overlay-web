import React from 'react'
import { View } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import { AgentAvatar } from '../shell/AgentAvatar'
import { T } from '../shell/primitives'
import { PillButton } from './PillButton'

/** Empty state: a resting creature, a title, one line and an optional action. */
export function CreatureEmpty({
  title,
  detail,
  shape = 'squircle',
  color = '#14b8a6',
  action,
  onAction,
}: {
  title: string
  detail?: string
  shape?: string
  color?: string
  action?: string
  onAction?: () => void
}) {
  const { theme, isDark } = useTheme()
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 40, paddingTop: 64, paddingBottom: 24 }}>
      <AgentAvatar agent={{ name: title, avatarShape: shape, avatarColor: color }} dark={isDark} foreground={theme.foreground} size={72} />
      <T style={{ marginTop: 8, fontSize: 20, fontFamily: 'GeistSemibold', letterSpacing: -0.3, color: theme.foreground, textAlign: 'center' }}>
        {title}
      </T>
      {detail ? <T style={{ fontSize: 15, lineHeight: 21, textAlign: 'center', color: theme.muted }}>{detail}</T> : null}
      {action && onAction ? (
        <View style={{ marginTop: 14, width: 180 }}>
          <PillButton label={action} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  )
}
