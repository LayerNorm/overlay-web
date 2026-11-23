import React from 'react'
import { View } from 'react-native'
import { HeaderHeightContext } from '@react-navigation/elements'
import { useSegments } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import { AgentAvatar } from '../shell/AgentAvatar'
import { T } from '../shell/primitives'
import { PillButton } from './PillButton'

const TAB_BAR_HEIGHT = 49

/**
 * Empty state: a resting creature, a title, one line and an optional action.
 * Grows to fill the remaining space and centres itself in the visible area, so
 * the parent scroll view's content container needs `flexGrow: 1`. That
 * container is as tall as the whole screen (the navigation and tab bars are
 * content insets), so the bars' height is reserved below to keep the centre
 * where you see it.
 */
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
  const header = React.use(HeaderHeightContext) ?? 0
  const insets = useSafeAreaInsets()
  const inTabs = useSegments()[0] === '(tabs)'
  const hidden = header + insets.bottom + (inTabs ? TAB_BAR_HEIGHT : 0)
  return (
    <View style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40, paddingVertical: 32, marginBottom: hidden }}>
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

