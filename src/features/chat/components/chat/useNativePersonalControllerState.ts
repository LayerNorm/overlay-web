'use client'

import { useCallback, useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import type { usePersonalChat } from '@/components/providers/PersonalChatProvider'
import type { ConversationRuntime } from '../chat-interface/types'
import { useNativeThreadSafety } from './useNativeThreadSafety'
import {
  nativePendingTurnsForScope,
  useNativePersonalRunLifecycle,
} from './native-personal-lifecycle'
import {
  nativePersonalCurrentTurnId,
  nativePersonalTurnIsActive,
  selectNativePersonalScope,
  useNativePersonalTranscript,
} from './useNativePersonalTranscript'
import { PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'

export function useNativePersonalSafetyScope({
  activeChatId,
  chatWorkspaceId,
  isTemporaryChat,
  nativePersonal,
  nativePersonalRoute,
  pendingRunConversationId,
}: {
  activeChatId: string | null
  chatWorkspaceId: string | null
  isTemporaryChat: boolean
  nativePersonal: ReturnType<typeof usePersonalChat>
  nativePersonalRoute: boolean
  pendingRunConversationId: string | null
}) {
  const nativePendingFirst = activeChatId === PENDING_FIRST_CHAT_ID
  const nativeSafetyConversationId = nativePersonalRoute
    ? nativePersonal.selectedConversationId ?? (nativePendingFirst ? pendingRunConversationId : null)
    : isTemporaryChat || nativePendingFirst ? null : activeChatId
  const nativeSafetyScopeConversationId = nativePersonalRoute && nativePendingFirst
    ? PENDING_FIRST_CHAT_ID
    : nativeSafetyConversationId
  const nativeScopeSynchronized = !nativePersonalRoute || (
    nativePersonal.selectedConversationId
      ? activeChatId === nativePersonal.selectedConversationId
        || (nativePendingFirst && pendingRunConversationId === nativePersonal.selectedConversationId)
      : activeChatId === null || nativePendingFirst
  )
  const nativeThreadSafety = useNativeThreadSafety({
    conversationId: nativeSafetyConversationId,
    scopeConversationId: nativeSafetyScopeConversationId,
    workspaceId: chatWorkspaceId,
    nativeMode: nativePersonalRoute && !isTemporaryChat,
    nativeExecution: nativePersonal.execution,
    verifiedUserId: nativePersonal.viewerUserId,
    scopeSynchronized: nativeScopeSynchronized,
  })
  return {
    nativePendingFirst,
    nativeSafetyConversationId,
    nativeScopeSynchronized,
    nativeThreadSafety,
  }
}

export function useNativePersonalControllerState({
  activeChatId,
  activeRuntime,
  chatWorkspaceId,
  hasAutomationContext,
  isNativePersonalChat,
  isTemporaryChat,
  nativePersonal,
  nativePersonalRoute,
  pendingRunConversationId,
  runtimeHydrationVersion,
  selectedActModel,
  selectedModels,
  setRuntimeHydrationVersion,
  nativePendingFirst,
  nativeScopeSynchronized,
  nativeThreadSafety,
}: {
  activeChatId: string | null
  activeRuntime: ConversationRuntime
  chatWorkspaceId: string | null
  hasAutomationContext: boolean
  isNativePersonalChat(id: string): boolean
  isTemporaryChat: boolean
  nativePersonal: ReturnType<typeof usePersonalChat>
  nativePersonalRoute: boolean
  pendingRunConversationId: string | null
  runtimeHydrationVersion: number
  selectedActModel: string
  selectedModels: string[]
  setRuntimeHydrationVersion: Dispatch<SetStateAction<number>>
  nativePendingFirst: boolean
  nativeScopeSynchronized: boolean
  nativeThreadSafety: ReturnType<typeof useNativeThreadSafety>
}) {
  const nativeJournalScopeMatches = nativePersonalRoute && (
    nativePersonal.selectedConversationId
      ? activeChatId === nativePersonal.selectedConversationId
        || (nativePendingFirst && pendingRunConversationId === nativePersonal.selectedConversationId)
      : nativePendingFirst || (!activeChatId && Boolean(pendingRunConversationId))
  )
  const nativeJournal = useMemo(() => nativeJournalScopeMatches
    ? nativePendingTurnsForScope(
      activeRuntime.nativePendingTurns,
      nativePersonal.viewerUserId,
      chatWorkspaceId,
      runtimeHydrationVersion,
    )
    : new Map(), [
    activeRuntime.nativePendingTurns,
    chatWorkspaceId,
    nativeJournalScopeMatches,
    nativePersonal.viewerUserId,
    runtimeHydrationVersion,
  ])
  const scope = selectNativePersonalScope({
    nativePersonalRoute,
    isTemporaryChat,
    hasAutomationContext,
    activeChatId,
    isNativePersonalChat,
    pendingRunConversationId,
    pendingTurns: nativeJournal.size,
    personal: nativePersonal,
    selectedModels,
    selectedActModel,
  })
  const nativeCommandScopeKey = JSON.stringify([
    nativePersonal.viewerUserId,
    chatWorkspaceId,
    nativePendingFirst ? PENDING_FIRST_CHAT_ID : scope.conversationId,
  ])
  const nativeCommandScopeRef = useRef({
    enabled: scope.enabled,
    scopeKey: nativeCommandScopeKey,
    synchronized: nativeScopeSynchronized,
  })
  useLayoutEffect(() => {
    nativeCommandScopeRef.current = {
      enabled: scope.enabled,
      scopeKey: nativeCommandScopeKey,
      synchronized: nativeScopeSynchronized,
    }
  }, [nativeCommandScopeKey, nativeScopeSynchronized, scope.enabled])
  const isNativeCommandScopeCurrent = useCallback(() => {
    const current = nativeCommandScopeRef.current
    return current.enabled && current.synchronized && current.scopeKey === nativeCommandScopeKey
  }, [nativeCommandScopeKey])
  const nativeCommandScope = useMemo(() => ({
    enabled: scope.enabled,
    writable: !nativeThreadSafety.readOnly,
    status: nativePersonal.execution.status,
    scopeKey: nativeCommandScopeKey,
    userId: nativePersonal.viewerUserId,
    workspaceId: chatWorkspaceId,
    conversationId: scope.conversationId,
    isCurrentScope: isNativeCommandScopeCurrent,
  }), [
    chatWorkspaceId,
    isNativeCommandScopeCurrent,
    nativeCommandScopeKey,
    nativePersonal.execution.status,
    nativePersonal.viewerUserId,
    nativeThreadSafety.readOnly,
    scope.conversationId,
    scope.enabled,
  ])
  const nativeJournalChanged = useCallback(() => {
    setRuntimeHydrationVersion(version => version + 1)
  }, [setRuntimeHydrationVersion])
  const nativeTranscriptState = useNativePersonalTranscript({
    enabled: scope.enabled,
    conversationId: scope.conversationId,
    summaryConversationId: scope.summaryConversationId,
    transcriptConversationId: nativePersonal.transcript.conversationId,
    pendingFirstConversationId: pendingRunConversationId,
    status: nativePersonal.transcript.status,
    rows: nativePersonal.transcript.rows,
    journal: nativeJournal,
    sourceJournal: activeRuntime.nativePendingTurns,
    sdkMessages: nativeJournalScopeMatches ? activeRuntime.actChat.messages : [],
    runtimeHydrationVersion,
    onJournalChange: nativeJournalChanged,
    isCurrentScope: isNativeCommandScopeCurrent,
  })
  const executionRun = nativePersonal.execution.value?.run ?? null
  const nativeCurrentTurnId = nativePersonalCurrentTurnId(
    nativeTranscriptState.projection, executionRun, [...nativeJournal.values()],
  )
  const nativeTurnActive = scope.enabled && nativePersonalTurnIsActive({
    projection: nativeTranscriptState.projection,
    pendingTurns: [...nativeJournal.values()],
    run: executionRun,
  })
  const nativeLifecycle = useNativePersonalRunLifecycle({
    enabled: scope.enabled,
    execution: nativePersonal.execution,
    active: nativeTurnActive,
  })

  return {
    ...scope,
    nativeCommandScope,
    nativeCurrentTurnId,
    nativeJournal,
    nativeJournalScopeMatches,
    nativeLifecycle,
    nativeScopeSynchronized,
    nativeThreadSafety,
    nativeTranscriptState,
    nativeTurnActive,
    pendingNativeTurnCount: nativeJournal.size,
    runConversationId: scope.enabled
      ? scope.conversationId
      : activeChatId ?? pendingRunConversationId,
  }
}
