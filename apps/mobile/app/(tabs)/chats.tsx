import React, { useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SectionList,
  Alert
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useTheme } from '../../hooks/useTheme'
import { spacing, fontSize, borderRadius } from '../../constants/theme'
import { ChatMeta } from '../../services/chatTypes'
import { loadChatsMeta, deleteChat } from '../../services/chatStorage'
import { formatDate } from '../../services/types'

function chatGetDateLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'TODAY'
  if (date.toDateString() === yesterday.toDateString()) return 'YESTERDAY'
  return date
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    .toUpperCase()
}

interface ChatRowProps {
  chat: ChatMeta
  theme: ReturnType<typeof useTheme>['theme']
  onPress: () => void
  onDelete: () => void
}

function ChatRow({ chat, theme, onPress, onDelete }: ChatRowProps): React.ReactElement {
  const handleDelete = (): void => {
    Alert.alert('Delete Chat', `Are you sure you want to delete "${chat.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          onDelete()
        }
      }
    ])
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={handleDelete}
      activeOpacity={0.7}
      style={[styles.chatRow, { backgroundColor: theme.background }]}
    >
      <View style={styles.chatRowContent}>
        <View style={[styles.chatRowIcon, { backgroundColor: theme.surface }]}>
          <Feather name="message-square" size={16} color={theme.textSecondary} />
        </View>
        <View style={styles.chatRowText}>
          <Text style={[styles.chatTitle, { color: theme.text }]} numberOfLines={1}>
            {chat.title || 'New Chat'}
          </Text>
          {chat.lastMessage && (
            <Text style={[styles.chatPreview, { color: theme.textSecondary }]} numberOfLines={1}>
              {chat.lastMessage}
            </Text>
          )}
        </View>
        <Text style={[styles.chatDate, { color: theme.textDisabled }]}>
          {formatDate(chat.updatedAt)}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

export default function ChatsScreen(): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()

  const [chats, setChats] = useState<ChatMeta[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [showSearch, setShowSearch] = useState(false)

  const refreshData = useCallback(async () => {
    const loaded = await loadChatsMeta()
    setChats(loaded)
    setIsLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      refreshData()
    }, [refreshData])
  )

  const handleNewChat = (): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push('/chat/new')
  }

  const handleOpenChat = useCallback(
    (id: string) => {
      router.push(`/chat/${id}`)
    },
    [router]
  )

  const handleDeleteChat = useCallback(
    async (id: string) => {
      await deleteChat(id)
      await refreshData()
    },
    [refreshData]
  )

  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) return chats
    const lowerQuery = searchQuery.toLowerCase()
    return chats.filter(
      (c) =>
        c.title.toLowerCase().includes(lowerQuery) ||
        c.lastMessage?.toLowerCase().includes(lowerQuery)
    )
  }, [chats, searchQuery])

  const sections = useMemo(() => {
    const grouped: Record<string, ChatMeta[]> = {}
    for (const chat of filteredChats) {
      const label = chatGetDateLabel(chat.updatedAt)
      if (!grouped[label]) grouped[label] = []
      grouped[label].push(chat)
    }
    return Object.entries(grouped).map(([title, data]) => ({ title, data }))
  }, [filteredChats])

  const hasChats = chats.length > 0

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Chats</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => setShowSearch(!showSearch)}
            style={styles.headerButton}
            activeOpacity={0.7}
          >
            <Feather name="search" size={20} color={theme.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.newButton, { backgroundColor: theme.buttonBg }]}
            onPress={handleNewChat}
            activeOpacity={0.7}
          >
            <Feather name="plus" size={20} color={theme.surface} />
          </TouchableOpacity>
        </View>
      </View>

      {showSearch && (
        <View style={[styles.searchContainer, { borderBottomColor: theme.border }]}>
          <Feather name="search" size={16} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search chats..."
            placeholderTextColor={theme.textDisabled}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Feather name="x" size={16} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {!hasChats && !isLoading ? (
        <View style={styles.emptyContent}>
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.surface }]}>
              <Feather name="message-square" size={32} color={theme.textSecondary} />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No chats yet</Text>
            <Text style={[styles.emptyDescription, { color: theme.textSecondary }]}>
              Start a new conversation with AI
            </Text>
            <TouchableOpacity
              style={[styles.emptyButton, { backgroundColor: theme.buttonBg }]}
              onPress={handleNewChat}
              activeOpacity={0.7}
            >
              <Text style={[styles.emptyButtonText, { color: theme.surface }]}>New Chat</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, { backgroundColor: theme.background }]}>
              <Text style={[styles.sectionHeaderText, { color: theme.textSecondary }]}>
                {section.title}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <ChatRow
              chat={item}
              theme={theme}
              onPress={() => handleOpenChat(item.id)}
              onDelete={() => handleDeleteChat(item.id)}
            />
          )}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '600'
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  headerButton: {
    padding: spacing.sm
  },
  newButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center'
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    marginBottom: spacing.sm
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    paddingVertical: spacing.xs
  },
  listContent: {
    paddingBottom: 100
  },
  sectionHeader: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    paddingTop: spacing.lg
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5
  },
  chatRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md
  },
  chatRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md
  },
  chatRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  chatRowText: {
    flex: 1,
    gap: 2
  },
  chatTitle: {
    fontSize: fontSize.md,
    fontWeight: '500'
  },
  chatPreview: {
    fontSize: fontSize.xs
  },
  chatDate: {
    fontSize: 10
  },
  emptyContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600'
  },
  emptyDescription: {
    fontSize: fontSize.sm,
    textAlign: 'center'
  },
  emptyButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    marginTop: spacing.md
  },
  emptyButtonText: {
    fontSize: fontSize.md,
    fontWeight: '500'
  }
})
