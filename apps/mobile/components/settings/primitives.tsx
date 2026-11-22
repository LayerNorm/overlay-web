import React from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { borderRadius, fontSize, spacing, type Theme } from '../../constants/theme'

/**
 * The Settings screen's row/card primitives, shared by the section components
 * under `components/settings/`. These were lifted out of
 * `app/settings.tsx` unchanged — keep them visually identical.
 */

export function SettingsSection({
  theme,
  title,
  icon,
  accessory,
  children,
}: {
  theme: Theme
  title: string
  icon: keyof typeof Feather.glyphMap
  accessory?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return (
    <View style={[settingsStyles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
      <View style={settingsStyles.cardHeader}>
        <View style={[settingsStyles.cardIcon, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
          <Feather name={icon} size={18} color={theme.textSecondary} />
        </View>
        <Text style={[settingsStyles.cardTitle, { color: theme.text }]}>{title}</Text>
        {accessory ? <View style={settingsStyles.sectionAccessory}>{accessory}</View> : null}
      </View>
      {children}
    </View>
  )
}

export function ToggleRow({
  theme,
  title,
  detail,
  value,
  disabled,
  onValueChange,
}: {
  theme: Theme
  title: string
  detail: string
  value: boolean
  disabled?: boolean
  onValueChange: (value: boolean) => void
}): React.ReactElement {
  return (
    <View style={[settingsStyles.row, { borderColor: theme.border }]}>
      <View style={settingsStyles.rowCopy}>
        <Text style={[settingsStyles.rowTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[settingsStyles.rowDetail, { color: theme.textSecondary }]}>{detail}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        accessibilityLabel={title}
      />
    </View>
  )
}

export function ActionRow({
  theme,
  icon,
  title,
  detail,
  onPress,
  destructive,
  busy,
}: {
  theme: Theme
  icon: keyof typeof Feather.glyphMap
  title: string
  detail: string
  onPress: () => void
  destructive?: boolean
  busy?: boolean
}): React.ReactElement {
  const color = destructive ? '#EF4444' : theme.text
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      style={[settingsStyles.row, { borderColor: theme.border }]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
      accessibilityState={{ busy }}
    >
      <Feather name={icon} size={16} color={destructive ? '#EF4444' : theme.textSecondary} />
      <View style={settingsStyles.rowCopy}>
        <Text style={[settingsStyles.rowTitle, { color }]}>{title}</Text>
        <Text style={[settingsStyles.rowDetail, { color: theme.textSecondary }]}>{detail}</Text>
      </View>
      {busy ? <ActivityIndicator size="small" color={theme.textSecondary} /> : <Feather name="chevron-right" size={16} color={theme.textSecondary} />}
    </TouchableOpacity>
  )
}

export function InfoRow({ theme, label, value }: { theme: Theme; label: string; value: string }): React.ReactElement {
  return (
    <View style={[settingsStyles.row, { borderColor: theme.border }]}>
      <Text style={[settingsStyles.infoLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text selectable numberOfLines={1} style={[settingsStyles.infoValue, { color: theme.text }]}>{value}</Text>
    </View>
  )
}

export function UsageStat({
  theme,
  label,
  value,
}: {
  theme: Theme
  label: string
  value: string
}): React.ReactElement {
  return (
    <View style={[settingsStyles.usageStat, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
      <Text style={[settingsStyles.usageLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[settingsStyles.usageValue, { color: theme.text }]} numberOfLines={1}>{value}</Text>
    </View>
  )
}

export function SegmentedControl<T extends string>({
  theme,
  value,
  options,
  disabled,
  onChange,
}: {
  theme: Theme
  value: T
  options: { label: string; value: T }[]
  disabled?: boolean
  onChange: (value: T) => void
}): React.ReactElement {
  return (
    <View style={[settingsStyles.segmented, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, opacity: disabled ? 0.6 : 1 }]}>
      {options.map((option) => {
        const active = value === option.value
        return (
          <TouchableOpacity
            key={option.value}
            activeOpacity={0.82}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[settingsStyles.segment, active && { backgroundColor: theme.foreground }]}
          >
            <Text style={[settingsStyles.segmentText, { color: active ? theme.background : theme.textSecondary }]} numberOfLines={1}>
              {option.label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

export const settingsStyles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xxl,
    padding: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    flex: 1,
    fontSize: fontSize.lg,
    lineHeight: 24,
    fontWeight: '700',
  },
  sectionAccessory: {
    minWidth: 24,
    alignItems: 'flex-end',
  },
  row: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowCopy: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    fontSize: fontSize.md,
    lineHeight: 20,
    fontWeight: '600',
  },
  rowDetail: {
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  helperText: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  infoLabel: {
    width: 92,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  infoValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 34,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  segmentText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  usageGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  usageStat: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: 4,
  },
  usageLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  usageValue: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
})

export function formatCents(value: number): string {
  return `$${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}`
}
