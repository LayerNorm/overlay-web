import React from 'react'
import { Pressable, StyleSheet, Text, View, type TextProps, type ViewStyle } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import type { Theme } from '../../constants/theme'

export function T({ style, ...props }: TextProps) {
  const weight = StyleSheet.flatten(style)?.fontWeight
  const fontFamily =
    weight === 'bold' || Number(weight) >= 600
      ? 'GeistSemibold'
      : Number(weight) >= 500
        ? 'GeistMedium'
        : 'Geist'
  return (
    <Text {...props} style={[{ fontFamily, fontSize: 14, includeFontPadding: false }, style]} />
  )
}

export function IconButton({
  icon: Icon,
  label,
  onPress,
  theme,
  style,
}: {
  icon: LucideIcon
  label: string
  onPress: () => void
  theme: Theme
  style?: ViewStyle
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: 34,
          height: 34,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 7,
          backgroundColor: pressed ? theme.surfaceSubtle : 'transparent',
        },
        style,
      ]}
    >
      <Icon size={17} strokeWidth={1.7} color={theme.muted} />
    </Pressable>
  )
}

export function Button({
  children,
  onPress,
  theme,
  secondary = false,
  disabled = false,
  icon: Icon,
}: {
  children: React.ReactNode
  onPress: () => void
  theme: Theme
  secondary?: boolean
  disabled?: boolean
  icon?: LucideIcon
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        paddingHorizontal: 14,
        paddingVertical: 9,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 7,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: pressed
          ? theme.surfaceSubtle
          : secondary
            ? theme.buttonSecondaryBg
            : 'transparent',
      })}
    >
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        {Icon ? <Icon size={14} color={theme.foreground} /> : null}
        <T style={{ color: theme.foreground, fontSize: 13 }}>{children}</T>
      </View>
    </Pressable>
  )
}
