import React, { useEffect, useState } from 'react'
import {
  Alert,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { hapticNotify } from '../../lib/haptics'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import type { ChatMeta } from '../../services/chatTypes'
import {
  archiveConversation,
  deleteConversation,
  renameConversation,
  setConversationShareVisibility,
} from '../../services/conversationActionsService'
import { BottomSheet } from '../ui/AppChrome'
import { ListRow, Section } from '../ui/primitives'

type SheetMode = 'actions' | 'rename' | 'share'

/**
 * Conversation actions — rename / share / archive / delete. Mirrors web
 * `ChatInlinePanel` + `ExportMenu`: personal chats archive/delete for 'self'
 * (channels/group DMs prompt for scope when multiplayer lands in Phase 3).
 */
export function ChatActionsSheet({
  theme,
  visible,
  chat,
  onClose,
  onChanged,
  onDeleted,
  onArchived,
}: {
  theme: Theme
  visible: boolean
  chat: ChatMeta | null
  onClose: () => void
  /** List should refresh (rename). */
  onChanged?: () => void
  /** Chat was deleted — parent navigates away if it was open. */
  onDeleted?: (chatId: string) => void
  /** Chat was archived — parent removes it from the list. */
  onArchived?: (chatId: string) => void
}): React.ReactElement {
  const [mode, setMode] = useState<SheetMode>('actions')
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [sharePublic, setSharePublic] = useState(false)

  useEffect(() => {
    if (visible) {
      setMode('actions')
      setRenameValue(chat?.title ?? '')
      setShareUrl(null)
      setSharePublic(false)
      setBusy(false)
    }
  }, [visible, chat?.id, chat?.title])

  if (!chat) return <></>

  const isShared = chat.conversationType === 'dm' || chat.conversationType === 'channel'

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (error) {
      Alert.alert('Something went wrong', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleRename = () =>
    run(async () => {
      const next = renameValue.trim()
      if (!next) return
      await renameConversation(chat!.id, next)
      onChanged?.()
      onClose()
    })

  const handleArchive = () =>
    run(async () => {
      const scope: 'self' | 'everyone' = 'self'
      await archiveConversation(chat!.id, scope)
      onArchived?.(chat!.id)
      onClose()
    })

  const handleDelete = () => {
    Alert.alert('Delete chat', `Delete "${chat!.title || 'this chat'}"? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            await deleteConversation(chat!.id, 'self')
            onDeleted?.(chat!.id)
            onClose()
          }),
      },
    ])
  }

  const handleShareToggle = (next: boolean) =>
    void run(async () => {
      const result = await setConversationShareVisibility(chat!.id, next ? 'public' : 'private')
      setSharePublic(result.visibility === 'public')
      setShareUrl(result.url)
    })

  const handleShareLink = async () => {
    if (!shareUrl) return
    try {
      await Share.share({ url: shareUrl, message: shareUrl })
    } catch {
      // user dismissed the share sheet
    }
  }

  return (
    <BottomSheet
      theme={theme}
      visible={visible}
      onClose={onClose}
      title={mode === 'rename' ? 'Rename chat' : mode === 'share' ? 'Share chat' : (chat.title || 'Chat')}
    >
      {mode === 'actions' ? (
        <Section theme={theme}>
          <ListRow
            theme={theme}
            icon="edit-2"
            title="Rename"
            onPress={() => {
              setRenameValue(chat.title ?? '')
              setMode('rename')
            }}
          />
          <ListRow
            theme={theme}
            icon="share"
            title="Share"
            subtitle="Create a public link to this chat"
            onPress={() => setMode('share')}
          />
          <ListRow
            theme={theme}
            icon="archive"
            title="Archive"
            subtitle={isShared ? 'Archives for you' : 'Move to archived chats'}
            onPress={() => void handleArchive()}
            disabled={busy}
          />
          <ListRow
            theme={theme}
            icon="trash-2"
            title="Delete"
            destructive
            onPress={handleDelete}
            disabled={busy}
          />
        </Section>
      ) : null}

      {mode === 'rename' ? (
        <View style={styles.renameWrap}>
          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            autoFocus
            placeholder="Chat title"
            placeholderTextColor={theme.textDisabled}
            onSubmitEditing={() => void handleRename()}
            style={[
              styles.renameInput,
              { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          />
          <TouchableOpacity
            activeOpacity={0.82}
            disabled={busy || !renameValue.trim()}
            onPress={() => void handleRename()}
            style={[
              styles.primaryButton,
              { backgroundColor: theme.foreground, opacity: busy || !renameValue.trim() ? 0.5 : 1 },
            ]}
          >
            <Text style={[styles.primaryButtonText, { color: theme.background }]}>
              {busy ? 'Saving…' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {mode === 'share' ? (
        <View>
          <Section theme={theme}>
            <ListRow
              theme={theme}
              icon="globe"
              title="Public link"
              subtitle={sharePublic ? 'Anyone with the link can view this chat' : 'Only you can see this chat'}
              selected={sharePublic}
              onPress={() => handleShareToggle(!sharePublic)}
              disabled={busy}
            />
          </Section>
          {sharePublic && shareUrl ? (
            <View style={[styles.shareBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.shareUrl, { color: theme.textSecondary }]} numberOfLines={1}>
                {shareUrl}
              </Text>
              <View style={styles.shareActions}>
                <TouchableOpacity
                  activeOpacity={0.82}
                  style={[styles.shareActionButton, { backgroundColor: theme.surfaceSubtle }]}
                  onPress={() => {
                    void Clipboard.setStringAsync(shareUrl)
                    hapticNotify()
                  }}
                >
                  <Feather name="copy" size={14} color={theme.text} />
                  <Text style={[styles.shareActionText, { color: theme.text }]}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.82}
                  style={[styles.shareActionButton, { backgroundColor: theme.foreground }]}
                  onPress={() => void handleShareLink()}
                >
                  <Feather name="share" size={14} color={theme.background} />
                  <Text style={[styles.shareActionText, { color: theme.background }]}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  renameWrap: {
    gap: spacing.md,
  },
  renameInput: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: fontSize.md,
  },
  primaryButton: {
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    paddingVertical: 12,
  },
  primaryButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  shareBox: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  shareUrl: {
    fontSize: 12,
  },
  shareActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  shareActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: borderRadius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  shareActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
})
