import React, { useEffect, useRef, useState } from 'react'
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, usePathname } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import type { Theme } from '../../constants/theme'
import { fontSize, spacing, borderRadius } from '../../constants/theme'
import type { ChatMeta } from '../../services/chatTypes'
import { useDrawer } from '../../contexts/DrawerContext'
import { GlassSurface } from '../ui/GlassSurface'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 320)
const CLOSE_THRESHOLD = DRAWER_WIDTH * 0.3
const OVERLAY_LOGO = require('../../../overlay-logo.png')

interface NavItem {
  label: string
  icon: React.ComponentProps<typeof Feather>['name']
  route: string
  disabled?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Chat', icon: 'message-circle', route: '/(tabs)/chat' },
  { label: 'Notes', icon: 'book-open', route: '/(tabs)/notes' },
  { label: 'Settings', icon: 'settings', route: '/(tabs)/settings' },
]

export function DrawerSidebar({
  theme,
  chats,
  activeChatId,
  onSelectChat,
  onCreateChat,
}: {
  theme: Theme
  chats: ChatMeta[]
  activeChatId: string | null
  onSelectChat: (chatId: string) => void
  onCreateChat: () => void
}): React.ReactElement | null {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const pathname = usePathname()
  const { drawerVisible, closeDrawer } = useDrawer()
  const [shouldRender, setShouldRender] = useState(drawerVisible)
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current
  const scrimOpacity = useRef(new Animated.Value(0)).current

  const isChatActive = pathname === '/chat' || pathname.startsWith('/(tabs)/chat')
  const isSettingsActive = pathname.startsWith('/settings') || pathname.startsWith('/(tabs)/settings')

  useEffect(() => {
    if (drawerVisible) {
      setShouldRender(true)
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: 0,
          tension: 85,
          friction: 18,
          useNativeDriver: true,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 0.45,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: -DRAWER_WIDTH,
          tension: 100,
          friction: 20,
          useNativeDriver: true,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setShouldRender(false)
      })
    }
  }, [drawerVisible, translateX, scrimOpacity])

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => {
        return gs.dx < -8 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5
      },
      onPanResponderMove: (_, gs) => {
        const newX = Math.min(0, gs.dx)
        translateX.setValue(newX)
        const progress = (newX + DRAWER_WIDTH) / DRAWER_WIDTH
        scrimOpacity.setValue(progress * 0.45)
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -CLOSE_THRESHOLD || gs.vx < -0.5) {
          closeDrawer()
        } else {
          Animated.parallel([
            Animated.spring(translateX, {
              toValue: 0,
              tension: 85,
              friction: 18,
              useNativeDriver: true,
            }),
            Animated.timing(scrimOpacity, {
              toValue: 0.45,
              duration: 150,
              useNativeDriver: true,
            }),
          ]).start()
        }
      },
    }),
  ).current

  if (!shouldRender) return null

  function isRouteActive(route: string): boolean {
    const segment = route.replace('/(tabs)/', '')
    if (segment === 'chat') {
      return pathname === '/chat' || pathname === '/(tabs)/chat' || (pathname === '/' && isChatActive)
    }
    return pathname.includes(segment)
  }

  function navigate(route: string): void {
    closeDrawer()
    router.push(route as Parameters<typeof router.push>[0])
  }

  return (
    <Modal
      visible={true}
      transparent
      animationType="none"
      onRequestClose={closeDrawer}
      statusBarTranslucent
    >
      <Animated.View
        style={[StyleSheet.absoluteFillObject, styles.scrim, { opacity: scrimOpacity }]}
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={closeDrawer} />
      </Animated.View>

      <Animated.View
        style={[
          styles.drawer,
          {
            width: DRAWER_WIDTH,
            backgroundColor: theme.sidebarSurface,
            borderRightColor: theme.glassBorder,
            transform: [{ translateX }],
            paddingTop: insets.top,
            paddingBottom: Math.max(insets.bottom, spacing.md),
          },
        ]}
        {...panResponder.panHandlers}
      >
        <GlassSurface pointerEvents="none" style={StyleSheet.absoluteFillObject} />
        {/* Header */}
        <View style={[styles.drawerHeader, { borderBottomColor: theme.border }]}>
          <Image source={OVERLAY_LOGO} style={styles.drawerLogo} resizeMode="contain" />
        </View>

        {/* Navigation */}
        <View style={styles.navSection}>
          {NAV_ITEMS.map((item) => {
            const active = isRouteActive(item.route)
            return (
              <TouchableOpacity
                key={item.label}
                style={[
                  styles.navItem,
                  active && { backgroundColor: theme.surfaceSubtle },
                  item.disabled && styles.navItemDisabled,
                ]}
                activeOpacity={item.disabled ? 1 : 0.65}
                disabled={item.disabled}
                onPress={() => {
                  if (!item.disabled) navigate(item.route)
                }}
              >
                <Feather
                  name={item.icon}
                  size={15}
                  color={item.disabled ? theme.mutedLight : active ? theme.text : theme.muted}
                />
                <Text
                  style={[
                    styles.navLabel,
                    {
                      color: item.disabled
                        ? theme.mutedLight
                        : active
                          ? theme.text
                          : theme.muted,
                    },
                  ]}
                >
                  {item.label}
                </Text>
                {item.disabled ? (
                  <Text style={[styles.soonBadge, { color: theme.mutedLight }]}>Soon</Text>
                ) : null}
              </TouchableOpacity>
            )
          })}

        </View>

        {/* Chat recents — shown only when on chat route */}
        {isChatActive && chats.length > 0 && (
          <View style={[styles.recentsSection, { borderTopColor: theme.border }]}>
            <View style={styles.recentsHeaderRow}>
              <Text style={[styles.recentsLabel, { color: theme.mutedLight }]}>Recents</Text>
              <TouchableOpacity
                onPress={() => {
                  onCreateChat()
                  closeDrawer()
                }}
                style={[styles.newChatButton, { borderColor: theme.border }]}
                activeOpacity={0.7}
              >
                <Feather name="plus" size={12} color={theme.muted} />
                <Text style={[styles.newChatLabel, { color: theme.muted }]}>New chat</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={styles.recentsList}
              contentContainerStyle={styles.recentsContent}
            >
              {chats.slice(0, 20).map((chat) => (
                <TouchableOpacity
                  key={chat.id}
                  onPress={() => {
                    onSelectChat(chat.id)
                    closeDrawer()
                  }}
                  activeOpacity={0.65}
                  style={[
                    styles.recentItem,
                    activeChatId === chat.id && {
                      backgroundColor: theme.surfaceSubtle,
                      borderRadius: borderRadius.md,
                    },
                  ]}
                >
                  <Text style={[styles.recentTitle, { color: theme.text }]} numberOfLines={1}>
                    {chat.title || 'New chat'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: '#000',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 10, height: 0 },
    elevation: 20,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  drawerHeader: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  drawerLogo: {
    width: 36,
    height: 36,
  },
  navSection: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  navItemDisabled: {
    opacity: 0.6,
  },
  navLabel: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '400',
  },
  soonBadge: {
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  recentsSection: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  recentsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  recentsLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.md,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  newChatLabel: {
    fontSize: fontSize.xs,
  },
  recentsList: {
    flex: 1,
  },
  recentsContent: {
    gap: 2,
  },
  recentItem: {
    paddingVertical: 9,
    paddingHorizontal: 8,
  },
  recentTitle: {
    fontSize: fontSize.sm,
    fontWeight: '400',
  },
})
