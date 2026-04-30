import React, { useEffect, useRef } from 'react'
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { GlassSurface } from './GlassSurface'

export function TopBarIconButton({
  theme,
  icon,
  onPress,
  active = false,
}: {
  theme: Theme
  icon: keyof typeof Feather.glyphMap
  onPress: () => void
  active?: boolean
}): React.ReactElement {
  return (
    <GlassSurface
      interactive
      style={[
        styles.iconButton,
        {
          backgroundColor: theme.glassBg,
          borderColor: theme.glassBorder,
        },
      ]}
    >
      <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={styles.iconButtonTouch}>
        <Feather name={icon} size={16} color={active ? theme.text : theme.textSecondary} />
      </TouchableOpacity>
    </GlassSurface>
  )
}

export function PageHeader({
  theme,
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  theme: Theme
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
  children?: React.ReactNode
}): React.ReactElement {
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderTop}>
        <View style={styles.pageHeaderCopy}>
          {eyebrow ? <Text style={[styles.eyebrow, { color: theme.textSecondary }]}>{eyebrow}</Text> : null}
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          {description ? (
            <Text style={[styles.description, { color: theme.textSecondary }]}>{description}</Text>
          ) : null}
        </View>
        {actions ? <View style={styles.pageHeaderActions}>{actions}</View> : null}
      </View>
      {children ? <View style={styles.pageHeaderBottom}>{children}</View> : null}
    </View>
  )
}

export function StatusPill({
  theme,
  label,
  tone = 'default',
}: {
  theme: Theme
  label: string
  tone?: 'default' | 'active' | 'danger'
}): React.ReactElement {
  const toneStyle =
    tone === 'active'
      ? { backgroundColor: theme.surfaceMuted, color: theme.text }
      : tone === 'danger'
        ? { backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#EF4444' }
        : { backgroundColor: theme.surfaceSubtle, color: theme.textSecondary }

  return (
    <View style={[styles.pill, { backgroundColor: toneStyle.backgroundColor, borderColor: theme.border }]}>
      <Text style={[styles.pillText, { color: toneStyle.color }]}>{label}</Text>
    </View>
  )
}

export function SearchField({
  theme,
  value,
  onChangeText,
  placeholder,
  autoFocus = false,
}: {
  theme: Theme
  value: string
  onChangeText: (value: string) => void
  placeholder: string
  autoFocus?: boolean
}): React.ReactElement {
  const [focused, setFocused] = React.useState(false)
  return (
    <GlassSurface interactive style={[styles.searchField, { backgroundColor: theme.glassBg, borderColor: focused ? theme.border : theme.glassBorder }]}>
      <Feather name="search" size={15} color={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={theme.textDisabled}
        autoFocus={autoFocus}
        style={[styles.searchInput, { color: theme.text }]}
      />
      {value ? (
        <TouchableOpacity onPress={() => onChangeText('')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Feather name="x" size={15} color={theme.textDisabled} />
        </TouchableOpacity>
      ) : null}
    </GlassSurface>
  )
}

export function SegmentedControl<T extends string>({
  theme,
  value,
  options,
  onChange,
}: {
  theme: Theme
  value: T
  options: ReadonlyArray<{ label: string; value: T }>
  onChange: (value: T) => void
}): React.ReactElement {
  return (
    <View style={[styles.segmented, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <TouchableOpacity
            key={option.value}
            onPress={() => {
              if (!isActive) {
                onChange(option.value)
              }
            }}
            activeOpacity={0.82}
            style={[
              styles.segment,
              {
                backgroundColor: isActive ? theme.foreground : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: isActive ? theme.background : theme.textSecondary },
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

export function EmptyState({
  theme,
  icon,
  title,
  description,
  action,
}: {
  theme: Theme
  icon: keyof typeof Feather.glyphMap
  title: string
  description: string
  action?: React.ReactNode
}): React.ReactElement {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
        <Feather name={icon} size={22} color={theme.textSecondary} />
      </View>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.emptyDescription, { color: theme.textSecondary }]}>{description}</Text>
      {action}
    </View>
  )
}

export function BottomSheet({
  theme,
  visible,
  onClose,
  title,
  headerAction,
  children,
}: {
  theme: Theme
  visible: boolean
  onClose: () => void
  title: string
  headerAction?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  const translateY = useRef(new Animated.Value(500)).current
  const scrimOpacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          tension: 85,
          friction: 18,
          useNativeDriver: true,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 500,
          tension: 100,
          friction: 20,
          useNativeDriver: true,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [visible, translateY, scrimOpacity])

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.scrim, { backgroundColor: theme.scrim, opacity: scrimOpacity }]}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.glassBg,
              transform: [{ translateY }],
            },
          ]}
        >
          <GlassSurface style={StyleSheet.absoluteFillObject} />
          <View style={styles.sheetHandleWrap}>
            <View style={[styles.sheetHandle, { backgroundColor: theme.border }]} />
          </View>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: theme.text }]}>{title}</Text>
            <View style={styles.sheetHeaderActions}>
              {headerAction}
              <TopBarIconButton theme={theme} icon="x" onPress={onClose} />
            </View>
          </View>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    overflow: 'hidden',
  },
  iconButtonTouch: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageHeader: {
    gap: spacing.md,
  },
  pageHeaderTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pageHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  pageHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pageHeaderBottom: {
    gap: spacing.sm,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  title: {
    fontSize: fontSize.xxl,
    lineHeight: fontSize.xxl + 4,
    fontWeight: '700',
    fontFamily: 'LibreBaskerville',
  },
  description: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  pill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  searchField: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    overflow: 'hidden',
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.sm,
    minHeight: 38,
  },
  segmented: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: borderRadius.full,
    padding: 3,
    gap: 4,
  },
  segment: {
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
  },
  sheetHandleWrap: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: 6,
  },
  sheetHandle: {
    width: 44,
    height: 4,
    borderRadius: 999,
  },
  sheetHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sheetTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  sheetHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetContent: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
})
