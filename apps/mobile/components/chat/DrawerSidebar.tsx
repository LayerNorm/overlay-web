import React, { useEffect, useRef, useState } from 'react'
import {
  Animated,
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
import type { NoteMeta } from '../../services/types'
import { useDrawer } from '../../contexts/DrawerContext'
import { GlassSurface } from '../ui/GlassSurface'
import { DRAWER_WIDTH } from '../ui/ScreenWithDrawer'

const CLOSE_THRESHOLD = DRAWER_WIDTH * 0.3
const OVERLAY_LOGO = require('../../assets/overlay-logo.png')

interface NavItem {
  label: string
  icon: React.ComponentProps<typeof Feather>['name']
  route: string
  disabled?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Chat', icon: 'message-circle', route: '/(tabs)/chat' },
  { label: 'Notes', icon: 'book-open', route: '/(tabs)/notes' },
  { label: 'Knowledge', icon: 'database', route: '/(tabs)/knowledge' },
  { label: 'Settings', icon: 'settings', route: '/(tabs)/settings' },
]

export function DrawerSidebar({
  theme,
  chats,
  activeChatId,
  onSelectChat,
  onCreateChat,
  notes,
  activeNoteId,
  onSelectNote,
  onCreateNote,
  variant = 'modal',
}: {
  theme: Theme
  chats: ChatMeta[]
  activeChatId: string | null
  onSelectChat: (chatId: string) => void
  onCreateChat: () => void
  notes?: NoteMeta[]
  activeNoteId?: string | null
  onSelectNote?: (id: string) => void
  onCreateNote?: () => void
  variant?: 'modal' | 'slide'
}): React.ReactElement | null {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const pathname = usePathname()
  const { drawerVisible, closeDrawer } = useDrawer()
  const [shouldRender, setShouldRender] = useState(drawerVisible)
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current
  const scrimOpacity = useRef(new Animated.Value(0)).current

  const isChatActive = pathname === '/chat' || pathname.startsWith('/(tabs)/chat')
  const isNotesActive = pathname === '/notes' || pathname.startsWith('/(tabs)/notes') || pathname.startsWith('/note/')
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

  if (variant === 'slide') {
    return (
      <View style={[styles.slideWrapper, { backgroundColor: theme.sidebarSurface }]}>
        <GlassSurface pointerEvents="none" style={StyleSheet.absoluteFillObject} />
        <DrawerContent
          theme={theme}
          insets={insets}
          isChatActive={isChatActive}
          isNotesActive={isNotesActive}
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={onSelectChat}
          onCreateChat={onCreateChat}
          notes={notes}
          activeNoteId={activeNoteId}
          onSelectNote={onSelectNote}
          onCreateNote={onCreateNote}
        />
      </View>
    )
  }

  if (!shouldRender) return null

  function isRouteActive(route: string): boolean {
    const segment = route.replace('/(tabs)/', '')
    if (segment === 'chat') {
      return pathname === '/chat' || pathname === '/(tabs)/chat' || (pathname === '/' && isChatActive)
    }
    if (segment === 'notes') {
      return pathname === '/notes' || pathname === '/(tabs)/notes' || pathname.startsWith('/note/') || isNotesActive
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
            transform: [{ translateX }],
            paddingTop: insets.top,
            paddingBottom: Math.max(insets.bottom, spacing.md),
          },
        ]}
        {...panResponder.panHandlers}
      >
        <GlassSurface pointerEvents="none" style={StyleSheet.absoluteFillObject} />
        <DrawerContent
          theme={theme}
          insets={insets}
          isChatActive={isChatActive}
          isNotesActive={isNotesActive}
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={onSelectChat}
          onCreateChat={onCreateChat}
          notes={notes}
          activeNoteId={activeNoteId}
          onSelectNote={onSelectNote}
          onCreateNote={onCreateNote}
          isRouteActive={isRouteActive}
          navigate={navigate}
        />
      </Animated.View>
    </Modal>
  )
}

function DrawerContent({
  theme,
  insets,
  isChatActive,
  isNotesActive,
  chats,
  activeChatId,
  onSelectChat,
  onCreateChat,
  notes,
  activeNoteId,
  onSelectNote,
  onCreateNote,
  isRouteActive: externalIsRouteActive,
  navigate: externalNavigate,
}: {
  theme: Theme
  insets: { top: number; bottom: number; left: number; right: number }
  isChatActive: boolean
  isNotesActive: boolean
  chats: ChatMeta[]
  activeChatId: string | null
  onSelectChat: (chatId: string) => void
  onCreateChat: () => void
  notes?: NoteMeta[]
  activeNoteId?: string | null
  onSelectNote?: (id: string) => void
  onCreateNote?: () => void
  isRouteActive?: (route: string) => boolean
  navigate?: (route: string) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { closeDrawer } = useDrawer()

  function isRouteActive(route: string): boolean {
    if (externalIsRouteActive) return externalIsRouteActive(route)
    const segment = route.replace('/(tabs)/', '')
    if (segment === 'chat') {
      return pathname === '/chat' || pathname === '/(tabs)/chat' || (pathname === '/' && isChatActive)
    }
    if (segment === 'notes') {
      return pathname === '/notes' || pathname === '/(tabs)/notes' || pathname.startsWith('/note/') || isNotesActive
    }
    return pathname.includes(segment)
  }

  function navigate(route: string): void {
    if (externalNavigate) {
      externalNavigate(route)
      return
    }
    closeDrawer()
    router.push(route as Parameters<typeof router.push>[0])
  }

  return (
    <>
      {/* Header with Logo and Brand */}
      <View style={[styles.drawerHeader, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.brandContainer}>
          <Image source={OVERLAY_LOGO} style={styles.drawerLogo} resizeMode="contain" />
          <Text style={[styles.brandText, { color: theme.text }]}>overlay</Text>
        </View>
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
                size={18}
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
        <View style={[styles.recentsSection, {}]}>
          <View style={styles.recentsHeaderRow}>
            <Text style={[styles.recentsLabel, { color: theme.mutedLight }]}>Recents</Text>
            <TouchableOpacity
              onPress={() => {
                onCreateChat()
                closeDrawer()
              }}
              style={[styles.newChatButton, {}]}
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

      {/* Notes recents — shown only when on notes route */}
      {isNotesActive && notes && notes.length > 0 && (
        <View style={[styles.recentsSection, {}]}>
          <View style={styles.recentsHeaderRow}>
            <Text style={[styles.recentsLabel, { color: theme.mutedLight }]}>Recent notes</Text>
            <TouchableOpacity
              onPress={() => {
                onCreateNote?.()
                closeDrawer()
              }}
              style={[styles.newChatButton, {}]}
              activeOpacity={0.7}
            >
              <Feather name="plus" size={12} color={theme.muted} />
              <Text style={[styles.newChatLabel, { color: theme.muted }]}>New note</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.recentsList}
            contentContainerStyle={styles.recentsContent}
          >
            {notes.slice(0, 20).map((note) => (
              <TouchableOpacity
                key={note.id}
                onPress={() => {
                  onSelectNote?.(note.id)
                  closeDrawer()
                }}
                activeOpacity={0.65}
                style={[
                  styles.recentItem,
                  activeNoteId === note.id && {
                    backgroundColor: theme.surfaceSubtle,
                    borderRadius: borderRadius.md,
                  },
                ]}
              >
                <Text style={[styles.recentTitle, { color: theme.text }]} numberOfLines={1}>
                  {note.title || 'Untitled note'}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </>
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
    overflow: 'hidden',
  },
  slideWrapper: {
    flex: 1,
    overflow: 'hidden',
  },
  drawerHeader: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: spacing.sm,
  },
  drawerLogo: {
    width: 28,
    height: 28,
  },
  brandText: {
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.5,
    fontFamily: 'LibreBaskerville',
  },
  navSection: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: 4,
  },
  navItemDisabled: {
    opacity: 0.6,
  },
  navLabel: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  soonBadge: {
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  recentsSection: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
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
