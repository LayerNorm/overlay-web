'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'
import type { NativePersonalExecutionState } from '@/components/providers/native-personal-execution'
import {
  nativeThreadSafetyNotice,
  nativeThreadSafetyStatus,
  type NativeThreadSafetyStatus,
} from '@/shared/chat/native-thread-safety'

export type RoomCompatibility = { compatibility: unknown; agentId: string | null }

export function useNativeThreadSafety({
  conversationId,
  scopeConversationId = conversationId,
  workspaceId,
  threadRootMessageId,
  nativeMode = false,
  nativeExecution,
  verifiedUserId,
  scopeSynchronized = true,
  liveCompatibility,
}: {
  conversationId: string | null
  scopeConversationId?: string | null
  workspaceId?: string | null
  threadRootMessageId?: string
  nativeMode?: boolean
  nativeExecution?: NativePersonalExecutionState
  verifiedUserId?: string | null
  scopeSynchronized?: boolean
  /** Rooms pass `useRoomCompatibility`: undefined while loading, null without access. */
  liveCompatibility?: RoomCompatibility | null
}) {
  const scope = JSON.stringify([workspaceId, scopeConversationId, threadRootMessageId, verifiedUserId])
  const activeScope = useRef<string | null>(scope)
  useLayoutEffect(() => {
    activeScope.current = scope
    return () => {
      if (activeScope.current === scope) activeScope.current = null
    }
  }, [scope])
  const writeCheck = useRef<{ scope: string } | null>(null)
  // Rooms read writability live instead of fetching it on every open and focus.
  const live = liveCompatibility
  const roomStatus: NativeThreadSafetyStatus = !conversationId
    ? 'writable'
    : live === undefined ? 'checking' : live === null ? 'error' : nativeThreadSafetyStatus(live.compatibility)
  const execution = nativeExecution?.status === 'ready' ? nativeExecution.value : null
  const nativeIdentityMatches = Boolean(execution
    && execution.conversationId === conversationId
    && execution.workspaceId === workspaceId
    && execution.userId === verifiedUserId)
  // The route updates just before the active chat, so a mismatch means still loading.
  const nativeStatus: NativeThreadSafetyStatus = !scopeSynchronized
    ? 'checking'
    : !conversationId
      ? 'writable'
      : nativeExecution?.status === 'loading'
        ? 'checking'
        : nativeIdentityMatches
          ? nativeThreadSafetyStatus(execution?.compatibility)
          : 'unavailable'
  const status = nativeMode ? nativeStatus : roomStatus

  // Both sources are live, so a check reads the current answer instead of fetching.
  const refresh = useCallback(async (): Promise<NativeThreadSafetyStatus> => (
    activeScope.current === scope ? status : 'error'
  ), [scope, status])

  const checkWritable = useCallback(async () => {
    if (activeScope.current !== scope || writeCheck.current?.scope === scope) {
      return { accepted: false, status: 'error' as const }
    }
    const check = { scope }
    writeCheck.current = check
    try {
      const checkedStatus = await refresh()
      return { accepted: checkedStatus === 'writable', status: checkedStatus }
    } finally {
      if (writeCheck.current === check) writeCheck.current = null
    }
  }, [refresh, scope])
  const ensureWritable = useCallback(async () => (await checkWritable()).accepted, [checkWritable])

  const isCurrentScope = useCallback(() => activeScope.current === scope, [scope])

  return {
    status,
    readOnly: status !== 'writable',
    notice: nativeThreadSafetyNotice(status),
    refresh,
    ensureWritable,
    checkWritable,
    isCurrentScope,
    agentId: nativeMode
      ? (execution?.compatibility as { agentId?: string } | undefined)?.agentId
      : live?.agentId ?? undefined,
  }
}

export type NativeThreadSafety = ReturnType<typeof useNativeThreadSafety>
