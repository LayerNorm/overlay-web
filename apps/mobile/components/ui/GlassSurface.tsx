import React from 'react'
import { Platform, View, type StyleProp, type ViewStyle, type ViewProps } from 'react-native'
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect'
import { useTheme } from '../../hooks/useTheme'

type GlassSurfaceProps = {
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
  tintColor?: string
  interactive?: boolean
} & Pick<ViewProps, 'pointerEvents'>

export function GlassSurface({
  children,
  style,
  tintColor,
  interactive = false,
  pointerEvents,
}: GlassSurfaceProps): React.ReactElement {
  const { isDark } = useTheme()
  const canUseGlass = Platform.OS === 'ios' && isGlassEffectAPIAvailable()

  if (!canUseGlass) {
    return <View pointerEvents={pointerEvents} style={style}>{children}</View>
  }

  return (
    <GlassView
      pointerEvents={pointerEvents}
      colorScheme={isDark ? 'dark' : 'light'}
      glassEffectStyle="regular"
      isInteractive={interactive}
      tintColor={tintColor}
      style={style}
    >
      {children}
    </GlassView>
  )
}
