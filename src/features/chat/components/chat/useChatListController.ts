'use client'

import { useCallback, useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  fetchChatList,
  getCachedChatList,
  primeChatList,
  type ChatListPageInfo,
} from '@/shared/chat/chat-list-cache'
import { useWorkspaceChanged } from '@/hooks/use-workspace-changed'
import type { Conversation } from '../chat-interface/types'
import { excludeNativePersonalChats } from '@/shared/chat/native-personal-chat'
import type { PersonalChatSummary } from '@/components/providers/PersonalChatProvider'

function filterLegacyRows(
  rows: Conversation[],
  nativePersonalEnabled: boolean,
  workspaceId?: string | null,
): Conversation[] {
  if (!nativePersonalEnabled) return rows
  return excludeNativePersonalChats(rows, workspaceId)
    .filter((chat) => !chat.workspaceId || chat.workspaceId === workspaceId)
}

export function useChatListController({
  initialChatPageInfo,
  initialChats,
  pendingTitleRef,
  nativePersonalChats = [],
  nativeSelectedSummary,
  nativePersonalEnabled = false,
  workspaceId,
  userId,
}: {
  initialChatPageInfo?: ChatListPageInfo
  initialChats?: Conversation[]
  pendingTitleRef: MutableRefObject<{ chatId: string; title: string } | null>
  nativePersonalChats?: PersonalChatSummary[]
  nativeSelectedSummary?: PersonalChatSummary | null
  nativePersonalEnabled?: boolean
  workspaceId?: string | null
  userId: string | null
}) {
  const [legacyChatState, setLegacyChatState] = useState(() => ({
    workspaceId,
    chats: userId
      ? filterLegacyRows(initialChats ?? getCachedChatList() ?? [], nativePersonalEnabled, workspaceId)
      : [],
  }))
  const legacyChats = useMemo(
    () => legacyChatState.workspaceId === workspaceId ? legacyChatState.chats : [],
    [legacyChatState, workspaceId],
  )
  const chats = useMemo(() => {
    if (!nativePersonalEnabled) return legacyChats
    if (!workspaceId) return []
    const rows = [...nativePersonalChats]
    if (nativeSelectedSummary && !rows.some((row) => row._id === nativeSelectedSummary._id)) {
      rows.push(nativeSelectedSummary)
    }
    return [...rows, ...filterLegacyRows(legacyChats, nativePersonalEnabled, workspaceId)]
      .sort((a, b) => b.lastModified - a.lastModified)
  }, [legacyChats, nativePersonalChats, nativePersonalEnabled, nativeSelectedSummary, workspaceId])

  const setChats: Dispatch<SetStateAction<Conversation[]>> = useCallback((update) => {
    setLegacyChatState((current) => {
      const currentChats = current.workspaceId === workspaceId ? current.chats : []
      const next = typeof update === 'function' ? update(currentChats) : update
      return {
        workspaceId,
        chats: filterLegacyRows(next, nativePersonalEnabled, workspaceId),
      }
    })
  }, [nativePersonalEnabled, workspaceId])

  useEffect(() => {
    if (userId && initialChats && !(nativePersonalEnabled && !workspaceId)) {
      primeChatList(filterLegacyRows(initialChats, nativePersonalEnabled, workspaceId), initialChatPageInfo)
    }
  }, [initialChatPageInfo, initialChats, nativePersonalEnabled, userId, workspaceId])

  // Snapshot pendingTitleRef before the async fetch so a concurrent PATCH completing
  // mid-flight can't clear the ref before we apply the local title override.
  const loadChats = useCallback(async () => {
    if (nativePersonalEnabled && !workspaceId) return
    try {
      const pending = pendingTitleRef.current
      const loadedChats = await fetchChatList({ force: true })
      const serverChats = filterLegacyRows(loadedChats, nativePersonalEnabled, workspaceId)
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
  }, [nativePersonalEnabled, pendingTitleRef, setChats, workspaceId])

  useWorkspaceChanged(loadChats)

  return {
    chats,
    loadChats,
    setChats,
  }
}
