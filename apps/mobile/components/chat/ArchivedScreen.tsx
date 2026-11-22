import React, { useCallback, useState } from 'react'
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTheme } from '../../hooks/useTheme'
import { useAppSession } from '../../contexts/AppSessionContext'
import { spacing } from '../../constants/theme'
import type { ChatMeta } from '../../services/chatTypes'
import { loadArchivedChats } from '../../services/chatStorage'
import { unarchiveConversation } from '../../services/conversationActionsService'
import { EmptyState, SearchField } from '../ui/AppChrome'
import { Section, ListRow, Badge } from '../ui/primitives'
import { FeatureGate } from '../ui/FeatureGate'

/** Archived conversations — `GET /conversations?archived=true` (web ChatArchivedView). */
export function ArchivedScreen(): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()
  const { capabilities } = useAppSession()

  const [chats, setChats] = useState<ChatMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true)
    try {
      const items = await loadArchivedChats()
      setChats(items)
    } catch {
      // keep previous list on failure
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const handleUnarchive = useCallback(
    (chat: ChatMeta) => {
      Alert.alert('Unarchive chat', `Move "${chat.title || 'this chat'}" back to chats?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unarchive',
          onPress: () => {
            void (async () => {
              setBusyId(chat.id)
              try {
                await unarchiveConversation(chat.id)
                setChats((current) => current.filter((c) => c.id !== chat.id))
              } catch (error) {
                Alert.alert('Could not unarchive', error instanceof Error ? error.message : 'Try again.')
              } finally {
                setBusyId(null)
              }
            })()
          },
        },
      ])
    },
    [],
  )

  const filtered = query.trim()
    ? chats.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()))
    : chats

  if (!capabilities.chat) {
    return <FeatureGate title="Chat is turned off" />
  }

  return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={theme.textSecondary} />
          }
          keyboardDismissMode="on-drag"
        >
          <SearchField
            theme={theme}
            value={query}
            onChangeText={setQuery}
            placeholder="Search archived chats"
          />

          {!loading && filtered.length === 0 ? (
            <EmptyState
              theme={theme}
              icon="archive"
              title={query ? 'No matches' : 'No archived chats'}
              description={
                query
                  ? 'Try a different search.'
                  : 'Chats you archive will show up here.'
              }
            />
          ) : (
            <Section theme={theme}>
              {filtered.map((chat) => (
                <ListRow
                  key={chat.id}
                  theme={theme}
                  icon="message-square"
                  title={chat.title || 'Chat'}
                  subtitle={
                    chat.archivedAt
                      ? `Archived ${new Date(chat.archivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                      : undefined
                  }
                  detail={busyId === chat.id ? '…' : undefined}
                  accessory={
                    chat.conversationType && chat.conversationType !== 'personal' ? (
                      <Badge theme={theme} label={chat.conversationType === 'dm' ? 'DM' : 'Channel'} />
                    ) : undefined
                  }
                  onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })}
                  onLongPress={() => handleUnarchive(chat)}
                  showChevron
                  disabled={busyId === chat.id}
                />
              ))}
            </Section>
          )}

          <Text style={[styles.hint, { color: theme.textDisabled }]}>
            Long-press a chat to unarchive it.
          </Text>
        </ScrollView>
      </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 17, fontWeight: '700' },
  content: { paddingHorizontal: spacing.md, paddingBottom: 120 },
  hint: { fontSize: 11, textAlign: 'center', marginTop: spacing.md },
})
