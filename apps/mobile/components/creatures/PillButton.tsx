import React from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { hapticImpact } from '../../lib/haptics'
import { useTheme } from '../../hooks/useTheme'

/** Full-width capsule button used for primary steps (onboarding, create). */
export function PillButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  accessibilityLabel,
}: {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'plain'
  disabled?: boolean
  busy?: boolean
  accessibilityLabel?: string
}) {
  const { theme } = useTheme()
  const inactive = disabled || busy
  const background =
    variant === 'primary' ? theme.foreground : variant === 'secondary' ? theme.surfaceSubtle : 'transparent'
  const color = variant === 'primary' ? theme.background : variant === 'plain' ? theme.muted : theme.foreground
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={() => {
        hapticImpact()
        onPress()
      }}
      style={({ pressed }) => ({
        height: 54,
        borderRadius: 27,
        borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background,
        opacity: disabled ? 0.4 : pressed ? 0.82 : 1,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {busy ? <ActivityIndicator color={color as string} /> : null}
        <Text style={{ fontFamily: 'GeistSemibold', fontSize: 17, color }}>{label}</Text>
      </View>
    </Pressable>
  )
}
