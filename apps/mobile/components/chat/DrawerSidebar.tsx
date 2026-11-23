import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  Animated,
  Image,
  Keyboard,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, usePathname, useLocalSearchParams } from 'expo-router'
import { Feather, Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Theme } from '../../constants/theme'
import { fontSize, spacing, borderRadius } from '../../constants/theme'
import type { ChatMeta } from '../../services/chatTypes'
import type { NoteMeta } from '../../services/types'
import { useDrawer } from '../../contexts/DrawerContext'
import { useAuth } from '../../contexts/AuthContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { resolveNavDestinations, type ResolvedNavItem } from '../../lib/destinations'
import { AppIcon } from '../ui/AppIcon'
import { DRAWER_WIDTH } from '../ui/ScreenWithDrawer'
import { GlassSurface } from '../ui/GlassSurface'
import { ChatActionsSheet } from './ChatActionsSheet'
import { NewDirectMessageSheet } from './NewDirectMessageSheet'
import { NewChannelSheet } from './NewChannelSheet'
import { subscribeNotifications } from '../../services/collaborationService'
import { subscribeChats } from '../../services/chatStorage'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'

/** Recents subview filter — mirrors the web `view=` switcher (ChatInlinePanel). */
type ChatListFilter = 'all' | 'personal' | 'dms' | 'channels'

const CHAT_FILTERS: Array<{ value: ChatListFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'personal', label: 'Chat' },
  { value: 'dms', label: 'DMs' },
  { value: 'channels', label: 'Channels' },
]

const CLOSE_THRESHOLD = DRAWER_WIDTH * 0.3
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OVERLAY_LOGO = require('../../assets/overlay-logo.png')

/**
 * Route matching for drawer nav items. Routes may carry a `?tab=` qualifier
 * A qualified route only matches when the current tab param equals it.
 */
function isMobileRouteActive(
  route: string,
  pathname: string,
  activeTab: string | undefined,
  flags: { isChatActive: boolean; isNotesActive: boolean },
): boolean {
  const [pathPart, queryPart] = route.split('?')
  const segment = pathPart.replace('/(tabs)/', '')
  if (segment === 'chat') {
    return pathname === '/chat' || pathname === '/chat' || (pathname === '/' && flags.isChatActive)
  }
  if (segment === 'notes') {
    return pathname === '/notes' || pathname === '/notes' || pathname.startsWith('/note/') || flags.isNotesActive
  }
  if (!pathname.includes(segment)) {
    return false
  }
  if (queryPart?.startsWith('tab=')) {
    return queryPart.slice(4) === activeTab
  }
  return true
}


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
  onChatsChanged,
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
  /** Chat list mutated (rename/archive/delete) — parent refreshes + resets if `removedChatId` was open. */
  onChatsChanged?: (removedChatId?: string) => void
  variant?: 'modal' | 'slide'
}): React.ReactElement | null {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const pathname = usePathname()
  const { tab: activeTabParam } = useLocalSearchParams<{ tab?: string }>()
  const { drawerVisible, closeDrawer } = useDrawer()
  const [shouldRender, setShouldRender] = useState(drawerVisible)
  const translateX = useMemo(() => new Animated.Value(-DRAWER_WIDTH), [])
  const scrimOpacity = useMemo(() => new Animated.Value(0), [])

  const isChatActive = pathname === '/chat' || pathname.startsWith('/chat')
  const isNotesActive = pathname === '/notes' || pathname.startsWith('/notes') || pathname.startsWith('/note/')

  useEffect(() => {
    if (drawerVisible) {
      requestAnimationFrame(() => setShouldRender(true))
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

  const panResponder = useMemo(
    () =>
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
    [closeDrawer, scrimOpacity, translateX],
  )

  if (variant === 'slide') {
    return (
      <View style={[styles.slideWrapper, { backgroundColor: theme.sidebarSurface }]}>
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
          onChatsChanged={onChatsChanged}
        />
      </View>
    )
  }

  if (!shouldRender) return null

  function isRouteActive(route: string): boolean {
    return isMobileRouteActive(route, pathname, activeTabParam, { isChatActive, isNotesActive })
  }

  function navigate(route: string): void {
    Keyboard.dismiss()
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
          onChatsChanged={onChatsChanged}
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
  onChatsChanged,
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
  onChatsChanged?: (removedChatId?: string) => void
  isRouteActive?: (route: string) => boolean
  navigate?: (route: string) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { tab: activeTabParam } = useLocalSearchParams<{ tab?: string }>()
  const { closeDrawer, drawerVisible } = useDrawer()
  const { user } = useAuth()
  const { destinations, featureFlags, capabilities, isFeatureEnabled } = useAppSession()
  const { activeWorkspaceId } = useWorkspace()
  const nativeReady = useNativeDataReady()
  const [actionsChat, setActionsChat] = useState<ChatMeta | null>(null)
  const [chatFilter, setChatFilter] = useState<ChatListFilter>('all')
  const [collabChats, setCollabChats] = useState<ChatMeta[]>([])
  const [newDmOpen, setNewDmOpen] = useState(false)
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [unreadByConversation, setUnreadByConversation] = useState<Record<string, number>>({})
  const [unreadActivityCount, setUnreadActivityCount] = useState(0)

  useEffect(() => {
    setUnreadByConversation({})
    setUnreadActivityCount(0)
    if (!nativeReady || !activeWorkspaceId) return
    return subscribeNotifications(items => {
      const counts: Record<string, number> = {}
      for (const item of items) {
        if (item.readAt || !item.conversationId) continue
        counts[item.conversationId] = (counts[item.conversationId] ?? 0) + 1
      }
      setUnreadByConversation(counts)
      setUnreadActivityCount(items.filter(item => !item.readAt).length)
    })
  }, [nativeReady, activeWorkspaceId])

  useEffect(() => {
    setCollabChats([])
    if (!nativeReady || !activeWorkspaceId || chatFilter === 'personal') return
    return subscribeChats(chatFilter, setCollabChats)
  }, [nativeReady, activeWorkspaceId, chatFilter])

  const handleChatsChanged = useCallback(
    (removedChatId?: string) => {
      onChatsChanged?.(removedChatId)
    },
    [onChatsChanged],
  )

  const navItems = useMemo(
    () => resolveNavDestinations(destinations, { featureFlags, capabilities, isFeatureEnabled }),
    [destinations, featureFlags, capabilities, isFeatureEnabled],
  )

  function isRouteActive(route: string): boolean {
    if (externalIsRouteActive) return externalIsRouteActive(route)
    return isMobileRouteActive(route, pathname, activeTabParam, { isChatActive, isNotesActive })
  }

  const navigateToLastNote = useCallback(async () => {
    try {
      const lastNoteId = await AsyncStorage.getItem('overlay:last-note-id')
      if (lastNoteId && notes?.find(n => n.id === lastNoteId)) {
        onSelectNote?.(lastNoteId)
        closeDrawer()
        return
      }
    } catch {
      // ignore
    }
    // Fallback to notes list
    if (externalNavigate) {
      externalNavigate('/notes')
    } else {
      closeDrawer()
      router.push('/notes')
    }
  }, [notes, onSelectNote, externalNavigate, closeDrawer, router])

  const navigate = useCallback((route: string): void => {
    if (externalNavigate) {
      externalNavigate(route)
      return
    }
    Keyboard.dismiss()
    closeDrawer()
    router.push(route as Parameters<typeof router.push>[0])
  }, [closeDrawer, externalNavigate, router])

  const handleNavItemPress = useCallback((item: ResolvedNavItem) => {
    if (!item.route) return
    if (item.id === 'notes') {
      void navigateToLastNote()
    } else {
      navigate(item.route)
    }
  }, [navigateToLastNote, navigate])


  const handleLongPressChat = useCallback((chat: ChatMeta) => {
    setActionsChat(chat)
  }, [])

  const handleLongPressNote = useCallback((note: NoteMeta) => {
    Alert.alert(
      note.title || 'Note',
      'Choose an action',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          // TODO: Implement delete
        }},
      ]
    )
  }, [])

  const getInitials = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    }
    if (user?.email) {
      return user.email[0].toUpperCase()
    }
    return 'U'
  }

  return (
    <View style={styles.drawerContent}>
      {/* Header with Logo and Brand */}
      <View style={[styles.drawerHeader, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.brandContainer}>
          <Image source={OVERLAY_LOGO} style={styles.drawerLogo} resizeMode="contain" alt="Overlay logo" />
          <Text style={[styles.brandText, { color: theme.text }]}>overlay</Text>
        </View>
      </View>

      {/* Main Content Area */}
      <View style={styles.mainContent}>
        {/* Navigation — driven by bootstrap destinations + capability gates */}
        <View style={styles.navSection}>
          {navItems.map((item) => {
            const disabled = !item.route
            const active = item.route ? isRouteActive(item.route) : false
            return (
              <View key={item.id}>
                <TouchableOpacity
                  style={[
                    styles.navItem,
                    active && {
                      backgroundColor: theme.surfaceSubtle,
                    },
                    disabled && styles.navItemDisabled,
                  ]}
                  activeOpacity={disabled ? 1 : 0.65}
                  disabled={disabled}
                  onPress={() => handleNavItemPress(item)}
                >
                  <AppIcon
                    sfSymbol={item.sfSymbol}
                    featherIcon={item.featherIcon}
                    size={18}
                    color={disabled ? theme.mutedLight : active ? theme.text : theme.muted}
                  />
                  <Text
                    style={[
                      styles.navLabel,
                      {
                        color: disabled
                          ? theme.mutedLight
                          : active
                            ? theme.text
                            : theme.muted,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                  {disabled ? (
                    <Text style={[styles.soonBadge, { color: theme.mutedLight }]}>Soon</Text>
                  ) : null}
                  {item.id === 'activity' && unreadActivityCount > 0 ? (
                    <View style={[styles.unreadBadge, { backgroundColor: theme.surfaceMuted }]}>
                      <Text style={[styles.unreadBadgeText, { color: theme.text }]}>
                        {unreadActivityCount > 9 ? '9+' : unreadActivityCount}
                      </Text>
                    </View>
                  ) : null}
                </TouchableOpacity>

              </View>
            )
          })}

          {/* Web */}
          <TouchableOpacity
            style={styles.navItem}
            activeOpacity={0.65}
            onPress={() => {
              closeDrawer()
              void Linking.openURL('https://getoverlay.io')
            }}
          >
            <Feather name="globe" size={18} color={theme.muted} />
            <Text style={[styles.navLabel, { color: theme.muted }]}>Web</Text>
            <Feather name="external-link" size={14} color={theme.mutedLight} />
          </TouchableOpacity>
        </View>

        {/* Chat recents — shown only when on chat route. The view filter mirrors
            the web sidebar's Personal/DMs/Channels/All switcher. */}
        {isChatActive && (
          <View style={[styles.recentsSection, {}]}>
            <View style={styles.recentsHeaderRow}>
              <Text style={[styles.recentsLabel, { color: theme.mutedLight }]}>Recents</Text>
              <View style={styles.recentsHeaderActions}>
                <TouchableOpacity
                  activeOpacity={0.65}
                  onPress={() => navigate('/archived')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.archivedLink, { color: theme.muted }]}>Archived</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.65}
                  onPress={() => {
                    if (chatFilter === 'dms') setNewDmOpen(true)
                    else if (chatFilter === 'channels') setNewChannelOpen(true)
                    else onCreateChat()
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="plus" size={16} color={theme.muted} />
                </TouchableOpacity>
              </View>
            </View>
            {/* Subview filter chips — Personal / DMs / Channels / All */}
            <View style={styles.filterChipsRow}>
              {CHAT_FILTERS.map((filter) => {
                const active = chatFilter === filter.value
                return (
                  <TouchableOpacity
                    key={filter.value}
                    activeOpacity={0.7}
                    onPress={() => setChatFilter(filter.value)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: active ? theme.surfaceSubtle : 'transparent',
                        borderColor: active ? theme.border : 'transparent',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        { color: active ? theme.text : theme.muted },
                      ]}
                    >
                      {filter.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={styles.recentsList}
              contentContainerStyle={styles.recentsContent}
            >
              {(chatFilter === 'personal' ? chats : collabChats)
                .filter((chat) => {
                  const type = chat.conversationType ?? 'personal'
                  if (chatFilter === 'personal') return type === 'personal'
                  if (chatFilter === 'dms') return type === 'dm'
                  if (chatFilter === 'channels') return type === 'channel'
                  return true
                })
                .slice(0, 30)
                .map((chat) => {
                  const type = chat.conversationType ?? 'personal'
                  const unread = unreadByConversation[chat.id] ?? 0
                  return (
                    <TouchableOpacity
                      key={chat.id}
                      onPress={() => {
                        if (type === 'dm') {
                          closeDrawer()
                          router.push({ pathname: '/dm/[id]', params: { id: chat.id } })
                        } else if (type === 'channel') {
                          closeDrawer()
                          router.push({ pathname: '/channel/[id]', params: { id: chat.id } })
                        } else {
                          onSelectChat(chat.id)
                          closeDrawer()
                        }
                      }}
                      onLongPress={() => handleLongPressChat(chat)}
                      delayLongPress={500}
                      activeOpacity={0.65}
                      style={[
                        styles.recentItem,
                        activeChatId === chat.id && {
                          backgroundColor: theme.surfaceSubtle,
                          borderRadius: borderRadius.md,
                        },
                      ]}
                    >
                      {type !== 'personal' ? (
                        <Feather
                          name={type === 'channel' ? 'hash' : 'message-circle'}
                          size={13}
                          color={theme.muted}
                          style={styles.recentTypeIcon}
                        />
                      ) : null}
                      <Text style={[styles.recentTitle, { color: theme.text }]} numberOfLines={1}>
                        {chat.title || (type === 'channel' ? 'channel' : 'New chat')}
                      </Text>
                      {unread > 0 ? (
                        <View style={[styles.unreadBadge, { backgroundColor: theme.surfaceMuted }]}>
                          <Text style={[styles.unreadBadgeText, { color: theme.text }]}>
                            {unread > 9 ? '9+' : unread}
                          </Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  )
                })}
            </ScrollView>
          </View>
        )}

        {/* Notes recents — shown only when on notes route */}
        {isNotesActive && notes && notes.length > 0 && (
          <View style={[styles.recentsSection, {}]}>
            <View style={styles.recentsHeaderRow}>
              <Text style={[styles.recentsLabel, { color: theme.mutedLight }]}>Recents</Text>
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
                  onLongPress={() => handleLongPressNote(note)}
                  delayLongPress={500}
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
      </View>

      {/* Bottom Floating Bar with Account & Search */}
      <View
        style={[styles.bottomBar, { bottom: insets.bottom }]}
      >
        <View style={styles.bottomBarContent}>
          {/* Account Button */}
          <GlassSurface interactive style={[styles.accountButton, { backgroundColor: theme.glassBg }]}>
            <TouchableOpacity
              style={styles.accountButtonInner}
              onPress={() => navigate('/settings')}
              activeOpacity={0.7}
            >
              {user?.profilePictureUrl ? (
                <Image
                  source={{ uri: user.profilePictureUrl }}
                  style={styles.profileImage}
                  alt="Profile picture"
                />
              ) : (
                <View style={[styles.profileInitials, { backgroundColor: theme.accent }]}>
                  <Text style={[styles.profileInitialsText, { color: theme.background }]}>
                    {getInitials()}
                  </Text>
                </View>
              )}
              <Text
                style={[styles.accountName, { color: theme.text }]}
                numberOfLines={1}
              >
                {user?.firstName && user?.lastName
                  ? `${user.firstName} ${user.lastName}`
                  : user?.email || 'Account'}
              </Text>
            </TouchableOpacity>
          </GlassSurface>

          {/* Search Button */}
          <GlassSurface
            interactive
            style={[styles.searchButton, { backgroundColor: theme.glassBg }]}
          >
            <TouchableOpacity
              style={styles.searchButtonInner}
              onPress={() => navigate('/search')}
              activeOpacity={0.7}
              accessibilityLabel="Search"
            >
              <Ionicons name="search" size={22} color={theme.text} />
            </TouchableOpacity>
          </GlassSurface>

          {/* New Button */}
          <GlassSurface
            interactive
            style={[styles.newButton, { backgroundColor: theme.glassBg }]}
          >
            <TouchableOpacity
              style={styles.newButtonInner}
              onPress={() => {
                // Create new based on current context
                if (isChatActive) {
                  onCreateChat()
                } else if (isNotesActive) {
                  onCreateNote?.()
                } else {
                  // Default to new chat
                  onCreateChat()
                }
                closeDrawer()
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={24} color={theme.text} />
            </TouchableOpacity>
          </GlassSurface>
        </View>
      </View>

      <ChatActionsSheet
        theme={theme}
        visible={actionsChat !== null}
        chat={actionsChat}
        onClose={() => setActionsChat(null)}
        onChanged={() => handleChatsChanged()}
        onDeleted={(chatId) => handleChatsChanged(chatId)}
        onArchived={(chatId) => handleChatsChanged(chatId)}
      />
      <NewDirectMessageSheet
        visible={newDmOpen}
        workspaceId={activeWorkspaceId ?? ''}
        theme={theme}
        onClose={() => setNewDmOpen(false)}
        onCreated={(dm) => {
          setNewDmOpen(false)
          closeDrawer()
          router.push({ pathname: '/dm/[id]', params: { id: dm.id } })
        }}
      />
      <NewChannelSheet
        visible={newChannelOpen}
        workspaceId={activeWorkspaceId ?? ''}
        theme={theme}
        onClose={() => setNewChannelOpen(false)}
        onCreated={(channel) => {
          setNewChannelOpen(false)
          closeDrawer()
          router.push({ pathname: '/channel/[id]', params: { id: channel.id } })
        }}
      />
    </View>
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
  workspaceSwitcherWrap: {
    paddingTop: spacing.md,
    alignItems: 'flex-start',
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
    fontSize: fontSize.lg,
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
  recentsHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  recentsLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  archivedLink: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  filterChipsRow: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
  },
  filterChip: {
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  filterChipText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 8,
  },
  recentTypeIcon: {
    marginTop: 1,
  },
  recentTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '400',
  },
  unreadBadge: {
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  unreadBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  drawerContent: {
    flex: 1,
    overflow: 'hidden',
  },
  mainContent: {
    flex: 1,
    overflow: 'hidden',
  },
  subItemsContainer: {
    paddingLeft: spacing.xl,
    paddingRight: spacing.sm,
  },
  subItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: 2,
  },
  subItemIcon: {
    marginLeft: 2,
  },
  subItemLabel: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '400',
  },
  bottomBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  bottomBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  accountButton: {
    flex: 1,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  accountButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  profileImage: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
  },
  profileInitials: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitialsText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  accountName: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  newButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newButtonInner: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonInner: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
