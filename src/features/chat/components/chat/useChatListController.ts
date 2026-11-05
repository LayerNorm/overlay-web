'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
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
  nativePersonalRoute = false,
): Conversation[] {
  if (!nativePersonalEnabled) return rows
  return excludeNativePersonalChats(rows, workspaceId)
    .filter((chat) => {
      if (chat.workspaceId && chat.workspaceId !== workspaceId) return false
      if (!chat.workspaceId && !['dm', 'channel'].includes(chat.conversationType ?? '')) return false
      if (nativePersonalRoute && (
        chat.scope === 'personal'
        || (chat.scope === undefined && (chat.conversationType === undefined || chat.conversationType === 'personal'))
      )) return false
      return true
    })
}

export function useChatListController({
  initialChatPageInfo,
  initialChats,
  pendingTitleRef,
  nativePersonalChats = [],
  nativeSelectedSummary,
  nativePersonalEnabled = false,
  nativePersonalRoute = false,
  allowLegacyMixedList = false,
  workspaceId,
  userId,
}: {
  initialChatPageInfo?: ChatListPageInfo
  initialChats?: Conversation[]
  pendingTitleRef: MutableRefObject<{ chatId: string; title: string } | null>
  nativePersonalChats?: PersonalChatSummary[]
  nativeSelectedSummary?: PersonalChatSummary | null
  nativePersonalEnabled?: boolean
  nativePersonalRoute?: boolean
  allowLegacyMixedList?: boolean
  workspaceId?: string | null
  userId: string | null
}) {
  const ownerKey = JSON.stringify([userId, workspaceId])
  const scope = useMemo(
    () => [userId, workspaceId, nativePersonalEnabled, nativePersonalRoute, allowLegacyMixedList] as const,
    [userId, workspaceId, nativePersonalEnabled, nativePersonalRoute, allowLegacyMixedList],
  )
  const scopeRef = useRef({ token: scope, requestEpoch: 0, active: true })
  useLayoutEffect(() => {
    const currentScope = { token: scope, requestEpoch: 0, active: true }
    scopeRef.current = currentScope
    return () => {
      currentScope.active = false
      currentScope.requestEpoch++
    }
  }, [scope])
  const [legacyChatState, setLegacyChatState] = useState(() => ({
    ownerKey,
    chats: userId && !(nativePersonalRoute && !allowLegacyMixedList)
      ? filterLegacyRows(
        initialChats ?? getCachedChatList() ?? [],
        nativePersonalEnabled,
        workspaceId,
        nativePersonalRoute,
      )
      : [],
  }))
  const legacyChats = useMemo(
    () => legacyChatState.ownerKey === ownerKey ? legacyChatState.chats : [],
    [legacyChatState, ownerKey],
  )
  const chats = useMemo(() => {
    if (nativePersonalRoute && !nativePersonalEnabled && !allowLegacyMixedList) return []
    if (!nativePersonalEnabled) return legacyChats
    if (!workspaceId) return []
    if (!nativePersonalRoute) {
      return filterLegacyRows(legacyChats, nativePersonalEnabled, workspaceId)
    }
    const rows = [...nativePersonalChats]
    if (nativeSelectedSummary && !rows.some((row) => row._id === nativeSelectedSummary._id)) {
      rows.push(nativeSelectedSummary)
    }
    const legacyRows = allowLegacyMixedList
      ? filterLegacyRows(legacyChats, nativePersonalEnabled, workspaceId, nativePersonalRoute)
      : []
    return [...rows, ...legacyRows]
      .sort((a, b) => b.lastModified - a.lastModified)
  }, [
    allowLegacyMixedList,
    legacyChats,
    nativePersonalChats,
    nativePersonalEnabled,
    nativePersonalRoute,
    nativeSelectedSummary,
    workspaceId,
  ])

  const setChats: Dispatch<SetStateAction<Conversation[]>> = useCallback((update) => {
    setLegacyChatState((current) => {
      const activeScope = scopeRef.current
      if (activeScope.token !== scope || !activeScope.active) return current
      const currentChats = current.ownerKey === ownerKey ? current.chats : []
      const next = typeof update === 'function' ? update(currentChats) : update
      return {
        ownerKey,
        chats: filterLegacyRows(next, nativePersonalEnabled, workspaceId, nativePersonalRoute),
      }
    })
  }, [nativePersonalEnabled, nativePersonalRoute, ownerKey, scope, workspaceId])

  useEffect(() => {
    if (userId && initialChats && !(
      (nativePersonalRoute && !allowLegacyMixedList)
      || (nativePersonalEnabled && !workspaceId)
    )) {
      primeChatList(
        filterLegacyRows(initialChats, nativePersonalEnabled, workspaceId, nativePersonalRoute),
        initialChatPageInfo,
      )
    }
  }, [
    allowLegacyMixedList,
    initialChatPageInfo,
    initialChats,
    nativePersonalEnabled,
    nativePersonalRoute,
    userId,
    workspaceId,
  ])

  // Snapshot pendingTitleRef before the async fetch so a concurrent PATCH completing
  // mid-flight can't clear the ref before we apply the local title override.
  const loadChats = useCallback(async () => {
    const activeScope = scopeRef.current
    if (activeScope.token !== scope || !activeScope.active) return
    if ((nativePersonalRoute && !allowLegacyMixedList) || (nativePersonalEnabled && !workspaceId)) return
    const requestEpoch = ++activeScope.requestEpoch
    try {
      const pending = pendingTitleRef.current
      const loadedChats = await fetchChatList({ force: true })
      if (scopeRef.current !== activeScope || !activeScope.active || requestEpoch !== activeScope.requestEpoch) return
      const serverChats = filterLegacyRows(loadedChats, nativePersonalEnabled, workspaceId, nativePersonalRoute)
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
  }, [allowLegacyMixedList, nativePersonalEnabled, nativePersonalRoute, pendingTitleRef, scope, setChats, workspaceId])

  useWorkspaceChanged(loadChats)

  return {
    chats,
    loadChats,
    setChats,
  }
}
