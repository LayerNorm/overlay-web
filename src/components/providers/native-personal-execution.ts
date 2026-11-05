'use client'

import { useQuery } from 'convex/react'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

export type NativePersonalExecution = FunctionReturnType<typeof api.chat.personal.getExecution>
export type NativePersonalExecutionState = {
  status: 'disabled' | 'loading' | 'ready' | 'unavailable'
  value: NativePersonalExecution | null
}
type ExecutionScope = {
  enabled: boolean
  canQuery: boolean
  workspaceId: string | null
  viewerUserId: string | null
  conversationId: string | null
  summaryConversationId: string | null
  transcriptConversationId: string | null
}

export function nativePersonalExecutionArgs(scope: ExecutionScope):
  FunctionArgs<typeof api.chat.personal.getExecution> | 'skip' {
  if (!scope.enabled || !scope.canQuery || !scope.workspaceId || !scope.viewerUserId
    || !scope.conversationId || scope.summaryConversationId !== scope.conversationId
    || scope.transcriptConversationId !== scope.conversationId) return 'skip'
  return {
    workspaceId: scope.workspaceId,
    conversationId: scope.conversationId as Id<'conversations'>,
  }
}

export function useNativePersonalExecution(scope: ExecutionScope & {
  transcriptStatus: 'disabled' | 'loading' | 'ready' | 'unavailable'
}): NativePersonalExecutionState {
  const query = useQuery(api.chat.personal.getExecution, nativePersonalExecutionArgs(scope))
  return scopedNativePersonalExecution({ ...scope, value: query })
}

export function scopedNativePersonalExecution({
  ...scope
}: ExecutionScope & {
  transcriptStatus: 'disabled' | 'loading' | 'ready' | 'unavailable'
  value: NativePersonalExecution | undefined
}): NativePersonalExecutionState {
  if (!scope.enabled) return { status: 'disabled', value: null }
  if (!scope.conversationId) {
    return { status: scope.transcriptStatus === 'unavailable' ? 'unavailable' : 'disabled', value: null }
  }
  if (!scope.canQuery || !scope.viewerUserId) return { status: 'loading', value: null }
  if (scope.transcriptStatus === 'unavailable') return { status: 'unavailable', value: null }
  if (scope.transcriptStatus === 'loading'
    || scope.summaryConversationId !== scope.conversationId
    || scope.transcriptConversationId !== scope.conversationId) {
    return { status: 'loading', value: null }
  }
  if (!scope.value) return { status: 'loading', value: null }
  if (scope.value.conversationId !== scope.conversationId
    || scope.value.workspaceId !== scope.workspaceId
    || scope.value.userId !== scope.viewerUserId) {
    return { status: 'unavailable', value: null }
  }
  return { status: 'ready', value: scope.value }
}
