'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import type { ConversationPin, ConversationSavedMessage, MessageReaction } from '@overlay/workspace-contracts'
import { toast } from '@overlay/ui/primitives'
import type { OptimisticMessage } from '../DirectMessageExperience.hooks'
import { useRoomMessageWrites } from './native-room-adapters'
import { useRoomApi, useRoomMessageActionsSource } from './room-state-adapters'

function requireArray<T>(value: T[] | undefined, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} were not returned`)
  return value
}

export function useMessageActions({
  isReadOnlyMessage,
  conversationId,

  reactions,
  setReactions,
  pins,
  setPins,
  savedMessages,
  setSavedMessages,
  loadMessages,
}: {
  isReadOnlyMessage?: (messageId: string) => boolean
  conversationId: string
  currentPrincipalId: string

  reactions: MessageReaction[]
  setReactions: Dispatch<SetStateAction<MessageReaction[]>>
  pins: ConversationPin[]
  setPins: Dispatch<SetStateAction<ConversationPin[]>>
  savedMessages: ConversationSavedMessage[]
  setSavedMessages: Dispatch<SetStateAction<ConversationSavedMessage[]>>
  setMessages: Dispatch<SetStateAction<OptimisticMessage[]>>
  loadMessages: () => Promise<void>
}) {
  const api = useRoomApi(conversationId)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const writes = useRoomMessageWrites(conversationId)

  async function copyMessagePermalink(messageId: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('message', messageId)
    try {
      await navigator.clipboard.writeText(url.toString())
      toast.success('Message link copied.')
    } catch {
      toast.error('Could not copy the message link.')
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    const current = reactions.find((reaction) => reaction.messageId === messageId && reaction.emoji === emoji)

    const result = await api.setReaction(conversationId, {
      messageId,
      emoji,
      enabled: !current?.reactedByCurrentPrincipal,
    })
    setReactions(requireArray(result.reactions, 'Conversation reactions'))
  }

  async function togglePinned(messageId: string) {
    const pinned = pins.some((pin) => pin.messageId === messageId)

    await api.setPinned(conversationId, { messageId, pinned: !pinned })
    const result = await api.pins(conversationId)
    setPins(requireArray(result.pins, 'Conversation pins'))
  }

  /**
   * Reporting records an audit event and tells the reporter it was received.
   * Nothing in the room changes; review policy arrives with enterprise
   * moderation.
   */
  async function reportMessage(messageId: string) {

    try {
      await api.reportMessage(conversationId, {
        messageId,
        reason: 'other',
      })
      toast.success('Report sent to the workspace owners.')
    } catch {
      toast.error('Could not send the report.')
    }
  }

  async function toggleSaved(messageId: string) {
    const saved = savedMessages.some((row) => row.conversationId === conversationId && row.messageId === messageId)

    await api.setSaved({ conversationId, messageId, saved: !saved })
    const result = await api.savedMessages()
    setSavedMessages(requireArray(result.savedMessages, 'Saved messages'))
  }

  async function saveEdit(messageId: string) {
    if (isReadOnlyMessage?.(messageId)) return
    const content = editingContent.trim()
    if (!content) return

    try {
      await writes.edit(messageId, content)
      setEditingId(null)
      await loadMessages()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not edit this message.')
    }
  }

  async function deleteMessage(messageId: string) {
    if (isReadOnlyMessage?.(messageId)) return
    try {
      await writes.remove(messageId)
      await loadMessages()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete this message.')
    }
  }

  return useRoomMessageActionsSource({
    editingId,
    setEditingId,
    editingContent,
    setEditingContent,
    copyMessagePermalink,
    toggleReaction,
    togglePinned,
    reportMessage,
    toggleSaved,
    saveEdit,
    deleteMessage,
  })
}
