'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  NATIVE_THREAD_SAFETY_CHANGED,
  nativeThreadSafetyErrorStatus,
  nativeThreadSafetyNotice,
  nativeThreadSafetyStatus,
  type NativeThreadSafetyStatus,
} from '@/shared/chat/native-thread-safety'

export type NativeThreadExecutionState = {
  status: 'disabled' | 'loading' | 'ready' | 'unavailable'
  value: { conversationId: string; workspaceId: string; userId: string; threadRootMessageId?: string; compatibility: unknown } | null
}

export function useNativeThreadSafety({
  conversationId,
  scopeConversationId = conversationId,
  workspaceId,
  threadRootMessageId,
  nativeMode = false,
  nativeExecution,
  verifiedUserId,
  scopeSynchronized = true,
}: {
  conversationId: string | null
  scopeConversationId?: string | null
  workspaceId?: string | null
  threadRootMessageId?: string
  nativeMode?: boolean
  nativeExecution?: NativeThreadExecutionState
  verifiedUserId?: string | null
  scopeSynchronized?: boolean
}) {
  const scope = JSON.stringify([workspaceId, scopeConversationId, threadRootMessageId, verifiedUserId])
  const activeScope = useRef<string | null>(scope)
  useLayoutEffect(() => {
    activeScope.current = scope
    return () => {
      if (activeScope.current === scope) activeScope.current = null
    }
  }, [scope])
  const request = useRef(0)
  const writeCheck = useRef<{ scope: string } | null>(null)
  const [snapshot, setSnapshot] = useState<{ scope: string; status: NativeThreadSafetyStatus; agentId?: string } | null>(null)
  const execution = nativeExecution?.status === 'ready' ? nativeExecution.value : null
  const nativeIdentityMatches = Boolean(execution
    && execution.conversationId === conversationId
    && execution.workspaceId === workspaceId
    && execution.userId === verifiedUserId
    && execution.threadRootMessageId === threadRootMessageId)
  const nativeStatus: NativeThreadSafetyStatus = !scopeSynchronized
    ? 'unavailable'
    : !conversationId
      ? 'writable'
      : nativeExecution?.status === 'loading'
        ? 'checking'
        : nativeIdentityMatches
          ? nativeThreadSafetyStatus(execution?.compatibility)
          : 'unavailable'
  const status = nativeMode
    ? nativeStatus
    : !conversationId ? 'writable' : snapshot?.scope === scope ? snapshot.status : 'checking'

  const refresh = useCallback(async () => {
    if (activeScope.current !== scope) return 'error'
    if (nativeMode) return nativeStatus
    if (!conversationId) return 'writable'
    const revision = ++request.current
    let next: NativeThreadSafetyStatus
    let agentId: string | undefined
    try {
      const result = await overlayAppClient.conversations.get<{ nativeThreadCompatibility?: unknown; agentId?: string }>({
        conversationId,
        ...(threadRootMessageId ? { threadRootMessageId } : {}),
      })
      next = nativeThreadSafetyStatus(result.nativeThreadCompatibility)
      agentId = result.agentId
    } catch (error) {
      next = nativeThreadSafetyErrorStatus(error)
    }
    if (activeScope.current === scope && request.current === revision) {
      setSnapshot({ scope, status: next, agentId })
      return next
    }
    return 'error'
  }, [conversationId, nativeMode, nativeStatus, scope, threadRootMessageId])

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

  useEffect(() => {
    if (nativeMode) return
    const initialRefreshTimer = window.setTimeout(() => { void refresh() }, 0)
    const recheck = () => { void refresh() }
    window.addEventListener('focus', recheck)
    window.addEventListener(NATIVE_THREAD_SAFETY_CHANGED, recheck)
    return () => {
      window.clearTimeout(initialRefreshTimer)
      request.current += 1
      window.removeEventListener('focus', recheck)
      window.removeEventListener(NATIVE_THREAD_SAFETY_CHANGED, recheck)
    }
  }, [nativeMode, refresh])

  useEffect(() => {
    if (nativeMode) return
    if (status !== 'unavailable') return
    const timer = window.setTimeout(() => { void refresh() }, 10_000)
    return () => window.clearTimeout(timer)
  }, [nativeMode, refresh, snapshot, status])

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
      : snapshot?.scope === scope ? snapshot.agentId : undefined,
  }
}

export type NativeThreadSafety = ReturnType<typeof useNativeThreadSafety>
