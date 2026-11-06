'use client'

import { useEffect, type Dispatch, type SetStateAction } from 'react'
import {
  CHAT_CREATED_EVENT,
  CHAT_DELETED_EVENT,
  CHAT_MODIFIED_EVENT,
  CHAT_TITLE_UPDATED_EVENT,
  mergeChatTitle,
  type ChatCreatedDetail,
  type ChatDeletedDetail,
  type ChatModifiedDetail,
  type ChatTitleUpdatedDetail,
} from '@/shared/chat/chat-title'
import {
  getCachedChatList,
  removeCachedChat,
  upsertCachedChat,
} from '@/shared/chat/chat-list-cache'
import type { Conversation, ConversationUiState } from '../chat-interface/types'
import { isNativePersonalChatCandidate } from '@/shared/chat/native-personal-chat'

export function useChatListEventSync({
  activeChatIdRef,
  nativePersonalEnabled,
  nativePersonalIds,
  nativePersonalRoute,
  isNativePersonalChat,
  workspaceId,
  resetActiveChatAfterDelete,
  setActiveChatDeleting,
  setActiveChatTitle,
  setChats,
  setDeletingChatIds,
  updateRuntimeUiState,
}: {
  activeChatIdRef: { current: string | null }
  nativePersonalEnabled: boolean
  nativePersonalIds: ReadonlySet<string>
  nativePersonalRoute: boolean
  isNativePersonalChat: (chatId: string) => boolean
  workspaceId?: string | null
  resetActiveChatAfterDelete: (chatId: string) => void
  setActiveChatDeleting: Dispatch<SetStateAction<boolean>>
  setActiveChatTitle: Dispatch<SetStateAction<string | null>>
  setChats: Dispatch<SetStateAction<Conversation[]>>
  setDeletingChatIds: Dispatch<SetStateAction<string[]>>
  updateRuntimeUiState: (
    chatId: string,
    updater: (prev: ConversationUiState) => ConversationUiState,
  ) => void
}) {
  useEffect(() => {
    function handleChatUpserted(event: Event) {
      const { detail } = event as CustomEvent<ChatCreatedDetail | ChatModifiedDetail>
      const nextChat = detail?.chat
      if (!nextChat?._id) return
      const ambiguousPersonal = (nextChat.conversationType ?? 'personal') === 'personal'
        && (!nextChat.workspaceId || nextChat.scope === undefined || nextChat.scope === 'personal')
      if (nativePersonalEnabled && (
        !workspaceId
        || nativePersonalIds.has(nextChat._id)
        || isNativePersonalChatCandidate(nextChat, workspaceId)
        || (nativePersonalRoute && isNativePersonalChat(nextChat._id))
        || ambiguousPersonal
        || (nextChat.scope === 'workspace' && !nextChat.workspaceId)
        || Boolean(workspaceId && nextChat.workspaceId && nextChat.workspaceId !== workspaceId)
      )) return
      upsertCachedChat(nextChat)
      setChats((prev) => {
        const existingIndex = prev.findIndex((chat) => chat._id === nextChat._id)
        if (existingIndex === -1) return [nextChat, ...prev]
        const existing = prev[existingIndex]
        const merged = {
          ...existing,
          ...nextChat,
          title: mergeChatTitle(existing.title, nextChat.title),
        }
        const withoutExisting = prev.filter((chat) => chat._id !== nextChat._id)
        return [merged, ...withoutExisting]
      })
    }

    function handleChatTitleUpdated(event: Event) {
      const { detail } = event as CustomEvent<ChatTitleUpdatedDetail>
      if (!detail?.chatId || !detail.title) return
      const cachedChat = getCachedChatList()?.find((chat) => chat._id === detail.chatId)
      const knownNonPilot = Boolean(cachedChat && (
        cachedChat.scope === 'workspace'
          ? Boolean(workspaceId && cachedChat.workspaceId === workspaceId)
          : ['dm', 'channel'].includes(cachedChat.conversationType ?? '')
            && (!cachedChat.workspaceId || cachedChat.workspaceId === workspaceId)
      ))
      if (nativePersonalEnabled && (
        !workspaceId
        || nativePersonalIds.has(detail.chatId)
        || (nativePersonalRoute && isNativePersonalChat(detail.chatId))
        || !knownNonPilot
      )) return
      upsertCachedChat({
        _id: detail.chatId,
        title: detail.title,
        lastModified: Date.now(),
      })
      setChats((prev) => {
        const existing = prev.find((chat) => chat._id === detail.chatId)
        if (!existing) return prev
        const updated = { ...existing, title: detail.title, lastModified: Date.now() }
        return [updated, ...prev.filter((chat) => chat._id !== detail.chatId)]
      })
      updateRuntimeUiState(detail.chatId, (prev) => ({ ...prev, activeChatTitle: detail.title }))
      if (activeChatIdRef.current === detail.chatId) {
        setActiveChatTitle(detail.title)
      }
    }

    function handleChatDeleted(event: Event) {
      const { detail } = event as CustomEvent<ChatDeletedDetail>
      if (!detail?.chatId) return
      const deletedChatId = detail.chatId
      removeCachedChat(deletedChatId)
      setDeletingChatIds((prev) => (
        prev.includes(deletedChatId) ? prev : [...prev, deletedChatId]
      ))
      if (activeChatIdRef.current === deletedChatId) {
        setActiveChatDeleting(true)
      }
      window.setTimeout(() => {
        setChats((prev) => prev.filter((chat) => chat._id !== deletedChatId))
        setDeletingChatIds((prev) => prev.filter((id) => id !== deletedChatId))
        if (activeChatIdRef.current === deletedChatId) {
          resetActiveChatAfterDelete(deletedChatId)
        }
        setActiveChatDeleting(false)
      }, 180)
    }

    window.addEventListener(CHAT_CREATED_EVENT, handleChatUpserted)
    window.addEventListener(CHAT_MODIFIED_EVENT, handleChatUpserted)
    window.addEventListener(CHAT_TITLE_UPDATED_EVENT, handleChatTitleUpdated)
    window.addEventListener(CHAT_DELETED_EVENT, handleChatDeleted)
    return () => {
      window.removeEventListener(CHAT_CREATED_EVENT, handleChatUpserted)
      window.removeEventListener(CHAT_MODIFIED_EVENT, handleChatUpserted)
      window.removeEventListener(CHAT_TITLE_UPDATED_EVENT, handleChatTitleUpdated)
      window.removeEventListener(CHAT_DELETED_EVENT, handleChatDeleted)
    }
  }, [
    activeChatIdRef,
    nativePersonalEnabled,
    nativePersonalIds,
    nativePersonalRoute,
    isNativePersonalChat,
    resetActiveChatAfterDelete,
    setActiveChatDeleting,
    setActiveChatTitle,
    setChats,
    setDeletingChatIds,
    updateRuntimeUiState,
    workspaceId,
  ])
}
