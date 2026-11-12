'use client'

import { useCallback, useEffect, useMemo, type MutableRefObject } from 'react'
import type { PersonalChatSummary, usePersonalChat } from '@/components/providers/PersonalChatProvider'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { toast } from '@overlay/ui/primitives'
import { nativeChatTitleForDisplay } from '@/features/chat/lib/persist-native-chat-title'
import { PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'

export function chatViewerUserId(initialUserId: string | null, authUserId: string | null, authLoading: boolean) {
  return authUserId ?? (authLoading ? initialUserId : null)
}

export function useNativePersonalRouteState({
  authLoading,
  isTemporaryChatRef,
  nativePersonal,
  searchParams,
  userId,
}: {
  authLoading: boolean
  isTemporaryChatRef: MutableRefObject<boolean>
  nativePersonal: ReturnType<typeof usePersonalChat>
  searchParams: Pick<URLSearchParams, 'get' | 'toString'>
  userId: string | null
}) {
  const nativePersonalEnabled = Boolean(userId) || authLoading
  const chatWorkspaceId = nativePersonal.workspaceId
  const nativePersonalRoute = nativePersonalEnabled && isNativePersonalRoute(searchParams)
  const nativePersonalChatIds = useMemo(() => new Set<string>([
    ...nativePersonal.active.rows.map((chat) => chat._id),
    ...nativePersonal.archived.rows.map((chat) => chat._id),
    ...(nativePersonal.selectedSummary ? [nativePersonal.selectedSummary._id] : []),
  ]), [nativePersonal.active.rows, nativePersonal.archived.rows, nativePersonal.selectedSummary])
  const isNativePersonalChat = useCallback((chatId: string) => (
    nativePersonalChatIds.has(chatId)
    || (
      nativePersonalRoute
      && !isTemporaryChatRef.current
      && nativePersonal.selectedConversationId === chatId
    )
  ), [
    nativePersonalChatIds,
    nativePersonalRoute,
    nativePersonal.selectedConversationId,
    isTemporaryChatRef,
  ])
  const getNativePersonalSummary = useCallback((chatId: string) => (
    nativePersonal.selectedSummary?._id === chatId
      ? nativePersonal.selectedSummary
      : nativePersonal.active.rows.find((chat) => chat._id === chatId)
        ?? nativePersonal.archived.rows.find((chat) => chat._id === chatId)
  ), [nativePersonal.active.rows, nativePersonal.archived.rows, nativePersonal.selectedSummary])
  const setNativePersonalRead = nativePersonal.setRead
  const markNativePersonalRead = useCallback((
    summary: PersonalChatSummary,
    throughMessageId: string,
  ) => {
    if (!summary.unread) return
    void setNativePersonalRead(
      summary,
      false,
      throughMessageId as Id<'conversationMessages'>,
    ).catch(() => toast.error('Could not mark chat as read.'))
  }, [setNativePersonalRead])

  return {
    chatWorkspaceId,
    getNativePersonalSummary,
    isNativePersonalChat,
    markNativePersonalRead,
    nativePersonalChatIds,
    nativePersonalEnabled,
    nativePersonalRoute,
  }
}

export function selectNativePersonalDisplay({
  activeChatId,
  activeChatTitle,
  getNativePersonalSummary,
  isNativePersonalChat,
  isTemporaryChat,
  nativePersonalRoute,
  pendingRunConversationId,
  selectedConversationId,
}: {
  activeChatId: string | null
  activeChatTitle: string | null
  getNativePersonalSummary(chatId: string): Pick<PersonalChatSummary, 'title'> | undefined
  isNativePersonalChat(chatId: string): boolean
  isTemporaryChat: boolean
  nativePersonalRoute: boolean
  pendingRunConversationId: string | null
  selectedConversationId: string | null
}) {
  const nativePersonalDisplay = nativePersonalRoute && !isTemporaryChat
  const displayActiveChatId = nativePersonalDisplay
    ? selectedConversationId
      ?? (activeChatId === PENDING_FIRST_CHAT_ID ? pendingRunConversationId : null)
    : activeChatId
  const displayedActiveChatTitle = nativePersonalDisplay
    ? displayActiveChatId
      ? nativeChatTitleForDisplay(true, getNativePersonalSummary(displayActiveChatId)?.title,
        activeChatId === displayActiveChatId ? activeChatTitle : null)
      : null
    : activeChatId
      ? nativeChatTitleForDisplay(isNativePersonalChat(activeChatId),
        getNativePersonalSummary(activeChatId)?.title, activeChatTitle)
      : activeChatTitle
  return { nativePersonalDisplay, displayActiveChatId, displayedActiveChatTitle }
}

export function useNativePersonalReadObservation({
  activeChatId,
  documentVisible,
  markRead,
  nativePersonal,
  nativePersonalRoute,
}: {
  activeChatId: string | null
  documentVisible: boolean
  markRead(summary: PersonalChatSummary, throughMessageId: string): void
  nativePersonal: ReturnType<typeof usePersonalChat>
  nativePersonalRoute: boolean
}) {
  useEffect(() => {
    const summary = nativePersonal.selectedSummary
    if (!nativePersonalRoute || !summary || summary._id !== activeChatId
      || nativePersonal.transcript.conversationId !== summary._id
      || !summary.unread || !summary.lastMessageId || !documentVisible) return
    const observed = nativePersonal.transcript.rows.some(row =>
      row.message._id === summary.lastMessageId || row.contextUser?._id === summary.lastMessageId)
    if (observed) markRead(summary, summary.lastMessageId)
  }, [
    activeChatId,
    documentVisible,
    markRead,
    nativePersonal.selectedSummary,
    nativePersonal.transcript.conversationId,
    nativePersonal.transcript.rows,
    nativePersonalRoute,
  ])
}

function isNativePersonalRoute(searchParams: Pick<URLSearchParams, 'get' | 'toString'>) {
  return !['dms', 'channels', 'room', 'rooms'].includes(searchParams.get('view') ?? '')
}
