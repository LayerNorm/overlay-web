'use client'

import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  dispatchChatModified,
  dispatchChatTitleUpdated,
  sanitizeChatTitle,
} from '@/shared/chat/chat-title'
import {
  upsertCachedChat,
} from '@/shared/chat/chat-list-cache'
import { generateTitle } from '@/features/chat/lib/generate-title'
import { DEFAULT_CHAT_TITLE } from '../chat-interface/constants'
import type { Conversation, ConversationUiState } from '../chat-interface/types'

export function useChatTitleController({
  activeChatId,
  activeChatIdRef,
  activeChatTitle,
  chats,
  loadChats,
  pendingTitleRef,
  setActiveChatTitle,
  setChats,
  titleGenerationEnabled,
  updateRuntimeUiState,
}: {
  activeChatId: string | null
  activeChatIdRef: MutableRefObject<string | null>
  activeChatTitle: string | null
  chats: Conversation[]
  loadChats: () => Promise<void>
  pendingTitleRef: MutableRefObject<{ chatId: string; title: string } | null>
  setActiveChatTitle: Dispatch<SetStateAction<string | null>>
  setChats: Dispatch<SetStateAction<Conversation[]>>
  titleGenerationEnabled: boolean
  updateRuntimeUiState: (
    chatId: string,
    updater: (prev: ConversationUiState) => ConversationUiState,
  ) => void
}) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingChatTitle, setEditingChatTitle] = useState('')
  const headerTitleInputRef = useRef<HTMLInputElement>(null)

  const applyChatTitleUpdate = useCallback((chatId: string, title: string) => {
    const nextTitle = sanitizeChatTitle(title, DEFAULT_CHAT_TITLE)
    pendingTitleRef.current = { chatId, title: nextTitle }
    setChats((prev) => {
      const exists = prev.some((chat) => chat._id === chatId)
      if (!exists) {
        return [{ _id: chatId, title: nextTitle, lastModified: Date.now() }, ...prev]
      }
      return prev.map((chat) => (chat._id === chatId ? { ...chat, title: nextTitle } : chat))
    })
    updateRuntimeUiState(chatId, (prev) => ({ ...prev, activeChatTitle: nextTitle }))
    if (activeChatIdRef.current === chatId) {
      setActiveChatTitle((prev) => prev !== null ? nextTitle : prev)
    }
    dispatchChatTitleUpdated({ chatId, title: nextTitle })
    return nextTitle
  }, [activeChatIdRef, pendingTitleRef, setActiveChatTitle, setChats, updateRuntimeUiState])

  const markChatModified = useCallback((chatId: string, title?: string | null) => {
    const existingTitle =
      title ||
      activeChatTitle ||
      chats.find((chat) => chat._id === chatId)?.title ||
      DEFAULT_CHAT_TITLE
    const chat = {
      _id: chatId,
      title: existingTitle,
      lastModified: Date.now(),
    }
    upsertCachedChat(chat)
    setChats((prev) => {
      const existing = prev.find((item) => item._id === chatId)
      const merged = { ...existing, ...chat, title: chat.title || existing?.title || DEFAULT_CHAT_TITLE }
      return [merged, ...prev.filter((item) => item._id !== chatId)]
    })
    dispatchChatModified({ chat })
  }, [activeChatTitle, chats, setChats])

  const beginHeaderChatRename = useCallback(() => {
    if (!activeChatId) return
    const title =
      activeChatTitle ??
      chats.find((chat) => chat._id === activeChatId)?.title ??
      DEFAULT_CHAT_TITLE
    setEditingChatId(activeChatId)
    setEditingChatTitle(title)
  }, [activeChatId, activeChatTitle, chats])

  useEffect(() => {
    if (!activeChatId || editingChatId !== activeChatId) return
    const input = headerTitleInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [activeChatId, editingChatId])

  const cancelChatRename = useCallback(() => {
    setEditingChatId(null)
    setEditingChatTitle('')
  }, [])

  useEffect(() => {
    cancelChatRename()
  }, [activeChatId, cancelChatRename])

  const commitChatRename = useCallback(async (chatId: string) => {
    const previousTitle =
      chats.find((chat) => chat._id === chatId)?.title ??
      (activeChatIdRef.current === chatId ? activeChatTitle ?? DEFAULT_CHAT_TITLE : DEFAULT_CHAT_TITLE)
    const nextTitle = sanitizeChatTitle(editingChatTitle, previousTitle)

    cancelChatRename()
    if (nextTitle === previousTitle) return

    applyChatTitleUpdate(chatId, nextTitle)

    try {
      const res = await overlayAppClient.conversations.updateResponse({ conversationId: chatId, title: nextTitle })
      if (!res.ok) throw new Error('Failed to rename chat')
    } catch {
      applyChatTitleUpdate(chatId, previousTitle)
    } finally {
      void loadChats()
    }
  }, [
    activeChatIdRef,
    activeChatTitle,
    applyChatTitleUpdate,
    cancelChatRename,
    chats,
    editingChatTitle,
    loadChats,
  ])

  const startFirstMessageRename = useCallback((chatId: string, text: string) => {
    if (!titleGenerationEnabled) return
    void generateTitle(text).then(async (aiTitle) => {
      if (!aiTitle) return
      const finalTitle = applyChatTitleUpdate(chatId, aiTitle)
      try {
        const res = await overlayAppClient.conversations.updateResponse({ conversationId: chatId, title: finalTitle })
        if (res.ok) void loadChats()
      } catch {
        // Keep the local optimistic title.
      }
    })
  }, [applyChatTitleUpdate, loadChats, titleGenerationEnabled])

  return {
    applyChatTitleUpdate,
    beginHeaderChatRename,
    cancelChatRename,
    commitChatRename,
    editingChatId,
    editingChatTitle,
    headerTitleInputRef,
    markChatModified,
    setEditingChatTitle,
    startFirstMessageRename,
  }
}
