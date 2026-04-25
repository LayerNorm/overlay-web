import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'

export function PanelCard({
  theme,
  children,
  padded = true
}: {
  theme: Theme
  children: React.ReactNode
  padded?: boolean
}): React.ReactElement {
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.surfaceElevated,
          borderColor: theme.border,
          padding: padded ? spacing.lg : 0,
          shadowColor: theme.preference === 'dark' ? '#000000' : '#09090b',
          shadowOpacity: theme.preference === 'dark' ? 0.24 : 0.06,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
          elevation: theme.preference === 'dark' ? 0 : 2
        }
      ]}
    >
      {children}
    </View>
  )
}

export function IconAction({
  theme,
  icon,
  onPress,
  active = false
}: {
  theme: Theme
  icon: keyof typeof Feather.glyphMap
  onPress: () => void
  active?: boolean
}): React.ReactElement {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.82}
      style={[
        styles.iconButton,
        {
          backgroundColor: active ? theme.buttonPrimaryBg : theme.surfaceSubtle,
          borderColor: theme.border
        }
      ]}
    >
      <Feather name={icon} size={17} color={active ? theme.buttonPrimaryText : theme.textSecondary} />
    </TouchableOpacity>
  )
}

export function SectionLabel({
  theme,
  children
}: {
  theme: Theme
  children: React.ReactNode
}): React.ReactElement {
  return <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>{children}</Text>
}

export function MetricTile({
  theme,
  label,
  value,
  accent
}: {
  theme: Theme
  label: string
  value: string
  accent?: string
}): React.ReactElement {
  return (
    <View
      style={[
        styles.metricTile,
        {
          backgroundColor: theme.surfaceSubtle,
          borderColor: theme.border
        }
      ]}
    >
      <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: accent || theme.text }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    overflow: 'hidden'
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  metricTile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 18,
    padding: spacing.md,
    gap: 4
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  metricValue: {
    fontSize: fontSize.xl,
    fontWeight: '700'
  }
})
