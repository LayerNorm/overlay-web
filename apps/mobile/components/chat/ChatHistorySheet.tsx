import React, { useMemo, useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import type { ChatMeta } from '../../services/chatTypes'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { BottomSheet, SearchField, StatusPill, TopBarIconButton } from '../ui/AppChrome'

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function ChatHistorySheet({
  theme,
  visible,
  chats,
  activeChatId,
  streamingChatId,
  onClose,
  onSelectChat,
  onCreateChat,
  onDeleteChat,
  onRenameChat,
}: {
  theme: Theme
  visible: boolean
  chats: ChatMeta[]
  activeChatId: string | null
  streamingChatId?: string | null
  onClose: () => void
  onSelectChat: (chatId: string) => void
  onCreateChat: () => void
  onDeleteChat: (chatId: string) => Promise<void>
  onRenameChat: (chatId: string, title: string) => Promise<void>
}): React.ReactElement {
  const [query, setQuery] = useState('')
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const filteredChats = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return chats
    }

    return chats.filter((chat) =>
      `${chat.title} ${chat.lastMessage || ''}`.toLowerCase().includes(normalized),
    )
  }, [chats, query])

  async function commitRename(chatId: string) {
    const nextTitle = editingTitle.trim()
    if (!nextTitle) {
      setEditingChatId(null)
      setEditingTitle('')
      return
    }

    await onRenameChat(chatId, nextTitle)
    setEditingChatId(null)
    setEditingTitle('')
  }

  return (
    <BottomSheet
      theme={theme}
      visible={visible}
      onClose={onClose}
      title="Chats"
      headerAction={
        <TopBarIconButton
          theme={theme}
          icon="plus"
          onPress={() => {
            onCreateChat()
            onClose()
          }}
        />
      }
    >
      <SearchField
        theme={theme}
        value={query}
        onChangeText={setQuery}
        placeholder="Search chats"
      />

      <View style={[styles.listCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        {filteredChats.length > 0 ? (
          filteredChats.map((chat, index) => {
            const isActive = chat.id === activeChatId
            const isEditing = editingChatId === chat.id
            const isStreaming = chat.id === streamingChatId

            return (
              <TouchableOpacity
                key={chat.id}
                onPress={() => {
                  if (isEditing) {
                    return
                  }
                  onSelectChat(chat.id)
                  onClose()
                }}
                activeOpacity={0.82}
                style={[
                  styles.row,
                  {
                    backgroundColor: isActive ? theme.surfaceSubtle : 'transparent',
                    borderBottomColor: index === filteredChats.length - 1 ? 'transparent' : theme.border,
                  },
                ]}
              >
                <View style={styles.rowCopy}>
                  <View style={styles.rowTitleLine}>
                    {isEditing ? (
                      <TextInput
                        value={editingTitle}
                        onChangeText={setEditingTitle}
                        autoFocus
                        onSubmitEditing={() => {
                          void commitRename(chat.id)
                        }}
                        onBlur={() => {
                          void commitRename(chat.id)
                        }}
                        placeholder="Chat title"
                        placeholderTextColor={theme.textDisabled}
                        style={[
                          styles.renameInput,
                          {
                            color: theme.text,
                            backgroundColor: theme.surface,
                            borderColor: theme.border,
                          },
                        ]}
                      />
                    ) : (
                      <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                        {chat.title || 'New chat'}
                      </Text>
                    )}

                    <View style={styles.rowPills}>
                      {isStreaming ? <StatusPill theme={theme} label="Live" tone="active" /> : null}
                      {isActive ? <StatusPill theme={theme} label="Open" tone="default" /> : null}
                    </View>
                  </View>

                  <Text style={[styles.rowMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                    {chat.lastMessage || 'Open the conversation to keep going.'}
                  </Text>

                  <Text style={[styles.rowDate, { color: theme.textDisabled }]}>
                    {formatTimestamp(chat.updatedAt)}
                  </Text>
                </View>

                {!isEditing ? (
                  <View style={styles.rowActions}>
                    <TopBarIconButton
                      theme={theme}
                      icon="edit-2"
                      onPress={() => {
                        setEditingChatId(chat.id)
                        setEditingTitle(chat.title)
                      }}
                    />
                    <TopBarIconButton
                      theme={theme}
                      icon="trash-2"
                      onPress={() => {
                        Alert.alert('Delete chat', `Delete "${chat.title}"?`, [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => {
                              void onDeleteChat(chat.id)
                            },
                          },
                        ])
                      }}
                    />
                  </View>
                ) : null}
              </TouchableOpacity>
            )
          })
        ) : (
          <View style={styles.emptyState}>
            <Feather name="message-square" size={22} color={theme.textSecondary} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No chats found</Text>
            <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>
              Start a new conversation or try a broader search term.
            </Text>
          </View>
        )}
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  listCard: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowCopy: {
    flex: 1,
    gap: 4,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowTitle: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  rowPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
  rowDate: {
    fontSize: 11,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  renameInput: {
    flex: 1,
    minHeight: 34,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.sm,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  emptyCopy: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
})
