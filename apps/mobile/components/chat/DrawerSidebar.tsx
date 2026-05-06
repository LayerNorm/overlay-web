import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  Animated,
  Image,
  Keyboard,
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
import { useRouter, usePathname } from 'expo-router'
import { Feather, Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Theme } from '../../constants/theme'
import { fontSize, spacing, borderRadius } from '../../constants/theme'
import type { ChatMeta } from '../../services/chatTypes'
import type { NoteMeta } from '../../services/types'
import { useDrawer } from '../../contexts/DrawerContext'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../hooks/useTheme'
import { DRAWER_WIDTH } from '../ui/ScreenWithDrawer'
import { GlassSurface } from '../ui/GlassSurface'

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
  // Voice is grandfathered for App Store launch and will be reintroduced
  // alongside the OverlayKeyboard extension. Keep the route file so existing
  // deep links don't crash, but hide the entry point from the sidebar.
]

interface KnowledgeSubItem {
  label: string
  icon: React.ComponentProps<typeof Feather>['name']
  route: string
}

const KNOWLEDGE_SUBITEMS: KnowledgeSubItem[] = [
  { label: 'Memories', icon: 'cpu', route: '/(tabs)/knowledge?tab=memories' },
  { label: 'Files', icon: 'folder', route: '/(tabs)/knowledge?tab=files' },
  { label: 'Outputs', icon: 'file-text', route: '/(tabs)/knowledge?tab=outputs' },
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
  const { closeDrawer, requestSearch } = useDrawer()
  const { user } = useAuth()
  const { isDark } = useTheme()
  const [knowledgeExpanded, setKnowledgeExpanded] = useState(false)
  const [showNewMenu, setShowNewMenu] = useState(false)

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

  const isKnowledgeActive = pathname.startsWith('/knowledge') || pathname.includes('/(tabs)/knowledge')

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
      externalNavigate('/(tabs)/notes')
    } else {
      closeDrawer()
      router.push('/(tabs)/notes')
    }
  }, [notes, onSelectNote, externalNavigate, closeDrawer, router])

  const navigateToLastKnowledgeView = useCallback(async () => {
    try {
      const lastView = await AsyncStorage.getItem('overlay:last-knowledge-view')
      if (lastView && ['memories', 'files', 'outputs'].includes(lastView)) {
        const subItem = KNOWLEDGE_SUBITEMS.find(s => s.label.toLowerCase() === lastView)
        if (subItem) {
          // Track the view
          await AsyncStorage.setItem('overlay:last-knowledge-view', lastView)
          if (externalNavigate) {
            externalNavigate(subItem.route)
          } else {
            closeDrawer()
            router.push(subItem.route as Parameters<typeof router.push>[0])
          }
          return
        }
      }
    } catch {
      // ignore
    }
    // Default to first knowledge item
    const defaultRoute = KNOWLEDGE_SUBITEMS[0]?.route ?? '/(tabs)/knowledge'
    if (externalNavigate) {
      externalNavigate(defaultRoute)
    } else {
      closeDrawer()
      router.push(defaultRoute as Parameters<typeof router.push>[0])
    }
  }, [externalNavigate, closeDrawer, router])

  function navigate(route: string): void {
    if (externalNavigate) {
      externalNavigate(route)
      return
    }
    Keyboard.dismiss()
    closeDrawer()
    router.push(route as Parameters<typeof router.push>[0])
  }

  const handleNavItemPress = useCallback((item: NavItem) => {
    if (item.disabled) return
    if (item.route === '/(tabs)/notes') {
      void navigateToLastNote()
    } else if (item.route === '/(tabs)/knowledge') {
      void navigateToLastKnowledgeView()
    } else {
      navigate(item.route)
    }
  }, [navigateToLastNote, navigateToLastKnowledgeView, navigate])

  const handleKnowledgeSubItemPress = useCallback(async (subItem: KnowledgeSubItem) => {
    const viewName = subItem.label.toLowerCase()
    try {
      await AsyncStorage.setItem('overlay:last-knowledge-view', viewName)
    } catch {
      // ignore
    }
    navigate(subItem.route)
  }, [navigate])

  const handleLongPressChat = useCallback((chat: ChatMeta) => {
    Alert.alert(
      chat.title || 'Chat',
      'Choose an action',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          // TODO: Implement delete
        }},
      ]
    )
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
          <Image source={OVERLAY_LOGO} style={styles.drawerLogo} resizeMode="contain" />
          <Text style={[styles.brandText, { color: theme.text }]}>overlay</Text>
        </View>
      </View>

      {/* Main Content Area */}
      <View style={styles.mainContent}>
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
                onPress={() => handleNavItemPress(item)}
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

          {/* Knowledge Dropdown */}
          <TouchableOpacity
            style={[
              styles.navItem,
              isKnowledgeActive && { backgroundColor: theme.surfaceSubtle },
            ]}
            activeOpacity={0.65}
            onPress={() => setKnowledgeExpanded(!knowledgeExpanded)}
          >
            <Feather
              name="database"
              size={18}
              color={isKnowledgeActive ? theme.text : theme.muted}
            />
            <Text
              style={[
                styles.navLabel,
                { color: isKnowledgeActive ? theme.text : theme.muted },
              ]}
            >
              Knowledge
            </Text>
            <Feather
              name={knowledgeExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={theme.muted}
            />
          </TouchableOpacity>

          {/* Knowledge Sub-items */}
          {knowledgeExpanded && (
            <View style={styles.subItemsContainer}>
              {KNOWLEDGE_SUBITEMS.map((subItem) => {
                const isActive = pathname.includes(subItem.route.replace('/(tabs)', ''))
                return (
                  <TouchableOpacity
                    key={subItem.label}
                    style={[
                      styles.subItem,
                      isActive && { backgroundColor: theme.surfaceSubtle },
                    ]}
                    activeOpacity={0.65}
                    onPress={() => handleKnowledgeSubItemPress(subItem)}
                  >
                    <Feather
                      name={subItem.icon}
                      size={16}
                      color={isActive ? theme.text : theme.muted}
                      style={styles.subItemIcon}
                    />
                    <Text
                      style={[
                        styles.subItemLabel,
                        { color: isActive ? theme.text : theme.muted },
                      ]}
                    >
                      {subItem.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          )}
        </View>

        {/* Chat recents — shown only when on chat route */}
        {isChatActive && chats.length > 0 && (
          <View style={[styles.recentsSection, {}]}>
            <View style={styles.recentsHeaderRow}>
              <Text style={[styles.recentsLabel, { color: theme.mutedLight }]}>Recents</Text>
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
              onPress={() => navigate('/(tabs)/settings')}
              activeOpacity={0.7}
            >
              {user?.profilePictureUrl ? (
                <Image
                  source={{ uri: user.profilePictureUrl }}
                  style={styles.profileImage}
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
              onPress={() => {
                closeDrawer()
                // Fire after the drawer close animation begins so the search
                // input on the underlying screen can claim focus cleanly.
                setTimeout(() => requestSearch(), 150)
              }}
              activeOpacity={0.7}
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
    fontSize: fontSize.md,
    fontWeight: '400',
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
