import React from 'react'
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { AppIcon, type FeatherIconName } from './AppIcon'

/**
 * Shared native list primitives — grouped sections with hairline separators
 * (iOS Settings style), rows with leading icon chips, avatars, and badges.
 * Components take `theme` explicitly, matching AppChrome conventions.
 */

export function Section({
  theme,
  label,
  children,
  style,
}: {
  theme: Theme
  label?: string
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
}): React.ReactElement {
  const rows = React.Children.toArray(children).filter(Boolean)
  return (
    <View style={[styles.section, style]}>
      {label ? (
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        {rows.map((child, index) => (
          <React.Fragment key={index}>
            {index > 0 ? (
              <View style={[styles.separator, { backgroundColor: theme.border }]} />
            ) : null}
            {child}
          </React.Fragment>
        ))}
      </View>
    </View>
  )
}

export function ListRow({
  theme,
  title,
  subtitle,
  icon,
  iconSfSymbol,
  detail,
  accessory,
  selected = false,
  disabled = false,
  destructive = false,
  showChevron = false,
  onPress,
  onLongPress,
}: {
  theme: Theme
  title: string
  subtitle?: string
  /** Feather fallback icon; ignored on iOS when `iconSfSymbol` renders. */
  icon?: FeatherIconName
  iconSfSymbol?: string
  detail?: string
  accessory?: React.ReactNode
  selected?: boolean
  disabled?: boolean
  destructive?: boolean
  showChevron?: boolean
  onPress?: () => void
  onLongPress?: () => void
}): React.ReactElement {
  const titleColor = destructive
    ? '#EF4444'
    : disabled
      ? theme.textDisabled
      : theme.text
  const iconColor = destructive
    ? '#EF4444'
    : disabled
      ? theme.textDisabled
      : theme.textSecondary

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      disabled={disabled || (!onPress && !onLongPress)}
      style={({ pressed }) => [
        styles.row,
        pressed && onPress ? { backgroundColor: theme.surfaceSubtle } : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ disabled, selected }}
    >
      {icon && iconSfSymbol ? (
        <View style={[styles.rowIconChip, { backgroundColor: theme.surfaceSubtle }]}>
          <AppIcon sfSymbol={iconSfSymbol} featherIcon={icon} size={15} color={iconColor} />
        </View>
      ) : icon ? (
        <View style={[styles.rowIconChip, { backgroundColor: theme.surfaceSubtle }]}>
          <AppIcon sfSymbol={icon} featherIcon={icon} size={15} color={iconColor} />
        </View>
      ) : null}
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: titleColor }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: theme.textSecondary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <AppIcon sfSymbol="checkmark" featherIcon="check" size={16} color={theme.text} />
      ) : null}
      {detail ? (
        <Text style={[styles.rowDetail, { color: theme.textSecondary }]} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
      {accessory}
      {showChevron && !selected ? (
        <AppIcon
          sfSymbol="chevron.right"
          featherIcon="chevron-right"
          size={14}
          color={theme.textDisabled}
        />
      ) : null}
    </Pressable>
  )
}

export function Avatar({
  theme,
  name,
  imageUrl,
  size = 32,
}: {
  theme: Theme
  name: string
  imageUrl?: string | null
  size?: number
}): React.ReactElement {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'U'

  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        accessibilityLabel={name}
      />
    )
  }

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.accent,
        },
      ]}
      accessibilityLabel={name}
    >
      <Text style={[styles.avatarText, { color: theme.background, fontSize: size * 0.4 }]}>
        {initials}
      </Text>
    </View>
  )
}

export function Badge({
  theme,
  label,
  tone = 'default',
}: {
  theme: Theme
  label: string
  tone?: 'default' | 'accent' | 'danger'
}): React.ReactElement {
  const colors =
    tone === 'accent'
      ? { bg: theme.accent, fg: theme.background }
      : tone === 'danger'
        ? { bg: 'rgba(239, 68, 68, 0.15)', fg: '#EF4444' }
        : { bg: theme.surfaceSubtle, fg: theme.textSecondary }

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.fg }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: 6,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.sm,
  },
  sectionCard: {
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.lg + 28,
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  rowIconChip: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  rowSubtitle: {
    fontSize: fontSize.sm,
    lineHeight: 17,
  },
  rowDetail: {
    fontSize: fontSize.sm,
    maxWidth: 110,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontWeight: '600',
  },
  badge: {
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
})
