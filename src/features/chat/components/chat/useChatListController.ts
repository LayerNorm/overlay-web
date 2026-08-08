'use client'

import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import {
  fetchChatList,
  getCachedChatList,
  primeChatList,
  type ChatListPageInfo,
} from '@/shared/chat/chat-list-cache'
import { useWorkspaceChanged } from '@/features/workspaces/lib/use-workspace-changed'
import type { Conversation } from '../chat-interface/types'

export function useChatListController({
  initialChatPageInfo,
  initialChats,
  pendingTitleRef,
  userId,
  useSeededGuestData = false,
}: {
  initialChatPageInfo?: ChatListPageInfo
  initialChats?: Conversation[]
  pendingTitleRef: MutableRefObject<{ chatId: string; title: string } | null>
  userId: string | null
  useSeededGuestData?: boolean
}) {
  const [chats, setChats] = useState<Conversation[]>(() =>
    userId || useSeededGuestData ? (initialChats ?? getCachedChatList() ?? []) : [],
  )

  useEffect(() => {
    if ((userId || useSeededGuestData) && initialChats) primeChatList(initialChats, initialChatPageInfo)
  }, [initialChatPageInfo, initialChats, useSeededGuestData, userId])

  // Snapshot pendingTitleRef before the async fetch so a concurrent PATCH completing
  // mid-flight can't clear the ref before we apply the local title override.
  const loadChats = useCallback(async () => {
    if (useSeededGuestData) return
    try {
      const pending = pendingTitleRef.current
      const serverChats = await fetchChatList({ force: true })
      const nextChats = pending
        ? serverChats.map((chat) => (
          chat._id === pending.chatId ? { ...chat, title: pending.title } : chat
        ))
        : serverChats
      setChats(nextChats)
      if (pending) {
        primeChatList(nextChats)
      }
      if (
        pending &&
        serverChats.some((chat) => chat._id === pending.chatId && chat.title === pending.title) &&
        pendingTitleRef.current?.chatId === pending.chatId
      ) {
        pendingTitleRef.current = null
      }
    } catch {
      // Chat list refresh is best-effort; existing local/cached state remains usable.
    }
  }, [pendingTitleRef, useSeededGuestData])

  useWorkspaceChanged(loadChats)

  return {
    chats,
    loadChats,
    setChats,
  }
}
