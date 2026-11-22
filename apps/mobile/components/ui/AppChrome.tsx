import { NativeSegmented } from '../navigation/NativeSegmented'
import React, { useEffect, useMemo } from 'react'
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { PanelLeft } from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useDrawer } from '../../contexts/DrawerContext'
import { GlassSurface } from './GlassSurface'

/** Default a11y labels for common Feather glyphs used in icon-only buttons. */
const ICON_A11Y_LABELS: Partial<Record<keyof typeof Feather.glyphMap, string>> = {
  menu: 'Open navigation menu',
  plus: 'Create new',
  search: 'Search',
  x: 'Close',
  'x-circle': 'Clear',
  'chevron-left': 'Back',
  'chevron-right': 'Forward',
  'chevron-down': 'Expand',
  'chevron-up': 'Collapse',
  'more-horizontal': 'More options',
  'more-vertical': 'More options',
  trash: 'Delete',
  'trash-2': 'Delete',
  edit: 'Edit',
  'edit-3': 'Edit',
  share: 'Share',
  'share-2': 'Share',
  download: 'Download',
  upload: 'Upload',
  send: 'Send',
  mic: 'Dictate',
  paperclip: 'Attach file',
  image: 'Attach image',
  camera: 'Take photo',
  settings: 'Settings',
  bell: 'Notifications',
  'bell-off': 'Mute notifications',
  'map-pin': 'Pinned',
  bookmark: 'Save',
  copy: 'Copy',
  'refresh-cw': 'Refresh',
  archive: 'Archive',
  star: 'Star',
  heart: 'Favorite',
  link: 'Copy link',
  'external-link': 'Open externally',
  play: 'Play',
  pause: 'Pause',
  square: 'Stop',
  check: 'Confirm',
  filter: 'Filter',
  sliders: 'Adjust options',
  'message-circle': 'Comments',
  'corner-up-left': 'Reply',
  'corner-down-right': 'Reply in thread',
}

export function TopBarIconButton({
  theme,
  icon,
  onPress,
  active = false,
  accessibilityLabel,
}: {
  theme: Theme
  icon: keyof typeof Feather.glyphMap
  onPress: () => void
  active?: boolean
  /** Overrides the derived icon label for assistive technologies. */
  accessibilityLabel?: string
}): React.ReactElement | null {
  const { isSidebarPermanent } = useDrawer()
  // The drawer menu button is dead chrome when the sidebar is permanent.
  if (isSidebarPermanent && icon === 'menu') return null
  return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.82}
        style={styles.iconButtonTouch}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? ICON_A11Y_LABELS[icon] ?? icon}
        accessibilityState={{ selected: active }}
      >
        {icon === 'menu' ? <PanelLeft size={17} strokeWidth={1.7} color={theme.foreground} /> : <Feather name={icon} size={16} color={active ? theme.text : theme.textSecondary} />}
      </TouchableOpacity>
  )
}

export function MainScreenHeader({ theme, topInset, leftSlot, centerSlot, rightSlot }: {
  theme: Theme
  isDark: boolean
  topInset: number
  blurHeight?: number
  leftSlot?: React.ReactNode
  centerSlot: React.ReactNode
  rightSlot?: React.ReactNode
}): React.ReactElement {
  return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: topInset, backgroundColor: theme.background, zIndex: 10 }}>
    <View style={{ minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {leftSlot}<View style={{ flex: 1 }}>{centerSlot}</View>{rightSlot}
    </View>
  </View>
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

export const SearchField = React.forwardRef<
  TextInput,
  {
    theme: Theme
    value: string
    onChangeText: (value: string) => void
    placeholder: string
    autoFocus?: boolean
  }
>(function SearchField(
  { theme, value, onChangeText, placeholder, autoFocus = false },
  ref,
): React.ReactElement {
  const [focused, setFocused] = React.useState(false)
  return (
    <GlassSurface interactive style={[styles.searchField, { backgroundColor: theme.glassBg, borderColor: focused ? theme.border : theme.glassBorder }]}>
      <Feather name="search" size={15} color={theme.textSecondary} />
      <TextInput
        ref={ref}
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
        <TouchableOpacity
          onPress={() => onChangeText('')}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Feather name="x" size={15} color={theme.textDisabled} />
        </TouchableOpacity>
      ) : null}
    </GlassSurface>
  )
})

/** Segmented control; renders the native system control. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  theme?: Theme
  value: T
  options: ReadonlyArray<{ label: string; value: T }>
  onChange: (value: T) => void
}): React.ReactElement {
  return <NativeSegmented value={value} options={options} onChange={onChange} />
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
  solid = false,
  tall = false,
  children,
}: {
  theme: Theme
  visible: boolean
  onClose: () => void
  title: string
  headerAction?: React.ReactNode
  solid?: boolean
  tall?: boolean
  children: React.ReactNode
}): React.ReactElement {
  const translateY = useMemo(() => new Animated.Value(500), [])
  const scrimOpacity = useMemo(() => new Animated.Value(0), [])
  const dragY = useMemo(() => new Animated.Value(0), [])
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_, gestureState) => {
          // Only allow dragging down
          if (gestureState.dy > 0) {
            dragY.setValue(gestureState.dy)
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          // Close if dragged down more than 100px or with velocity
          if (gestureState.dy > 100 || gestureState.vy > 0.5) {
            onClose()
          } else {
            // Snap back to open position
            Animated.spring(dragY, {
              toValue: 0,
              tension: 300,
              friction: 30,
              useNativeDriver: true,
            }).start()
          }
        },
      }),
    [dragY, onClose],
  )

  // Reset drag when opening
  useEffect(() => {
    if (visible) {
      dragY.setValue(0)
    }
  }, [visible, dragY])

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

  // Combine translateY animation with drag
  const animatedTranslateY = useMemo(() => Animated.add(translateY, dragY), [dragY, translateY])

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
              backgroundColor: solid ? theme.surface : theme.glassBg,
              maxHeight: tall ? '92%' : '78%',
              transform: [{ translateY: animatedTranslateY }],
            },
          ]}
        >
          {solid ? null : <GlassSurface style={StyleSheet.absoluteFillObject} />}
          {/* Draggable handle area */}
          <View {...panResponder.panHandlers} style={styles.dragHandleArea}>
            <View style={styles.sheetHandleWrap}>
              <View style={[styles.sheetHandle, { backgroundColor: theme.border }]} />
            </View>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: theme.text }, solid ? { fontFamily: 'GeistSemibold', fontSize: 18 } : null]}>{title}</Text>
              {headerAction ? <View style={styles.sheetHeaderActions}>{headerAction}</View> : null}
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
  mainHeaderBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99,
  },
  blurLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  mainHeaderRow: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  mainHeaderSide: {
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainHeaderCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
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
  dragHandleArea: {
    cursor: 'pointer',
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
})
