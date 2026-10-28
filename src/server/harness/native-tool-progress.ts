import 'server-only'

import { persistAgentToolProgress } from '@/server/agents/agent-message-stream'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { refreshNativeHarnessAccess, type NativeHarnessAccess, type NativeHarnessContext } from './native-access'

export type NativeHarnessToolProgress = {
  toolCallId: string
  toolName: string
  input: unknown
  state: 'input-available' | 'output-available' | 'output-error'
  output?: unknown
}

function toolInvocationPart(progress: NativeHarnessToolProgress): Record<string, unknown> {
  return {
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: progress.toolCallId,
      toolName: progress.toolName,
      state: progress.state,
      toolInput: progress.input,
      ...(progress.output === undefined ? {} : { toolOutput: progress.output }),
    },
  }
}

function sameToolCall(part: Record<string, unknown>, toolCallId: string): boolean {
  if (part.type !== 'tool-invocation' || !part.toolInvocation || typeof part.toolInvocation !== 'object') return false
  return (part.toolInvocation as Record<string, unknown>).toolCallId === toolCallId
}

function isExistingInputToolCall(part: Record<string, unknown> | undefined, progress: NativeHarnessToolProgress): boolean {
  if (!part || !sameToolCall(part, progress.toolCallId)) return false
  const invocation = part.toolInvocation as Record<string, unknown>
  return invocation.toolName === progress.toolName && invocation.state === 'input-available'
}

/**
 * Tool progress is a best-effort display snapshot. The terminal delivery
 * rewrites the row with the authoritative Harness transcript.
 */
export async function projectNativeHarnessToolProgress(
  access: NativeHarnessAccess,
  context: NativeHarnessContext,
  progress: NativeHarnessToolProgress,
): Promise<void> {
  if (access.runId !== `workspace:${access.agentRunId}`) return

  try {
    const store = getOverlayServerContext().appData.repositories.conversationCollaboration
    const finalState = progress.state !== 'input-available'
    const accessOptions = finalState ? { allowCancelledToolProgress: true } : undefined
    const before = await refreshNativeHarnessAccess(access, context, progress.toolName, accessOptions)
    const [message] = await store.listMessages({
      actorUserId: access.actorUserId,
      conversationId: access.conversationId,
      messageId: access.assistantMessageId,
      limit: 1,
      workspaceId: access.workspaceId,
    })
    if (!message || message._id !== access.assistantMessageId
      || message.turnId !== access.turnId
      || message.authorKind !== 'agent'
      || message.authorPrincipalId !== access.agentPrincipalId
      || message.status !== 'generating') return

    const parts = (message.parts ?? [])
      .filter(part => part.type !== 'reasoning')
      .map(part => ({ ...part }))
    const nextPart = toolInvocationPart(progress)
    const existingIndex = parts.findIndex(part => sameToolCall(part, progress.toolCallId))
    const existingInputToolCall = isExistingInputToolCall(parts[existingIndex], progress)
    if (before.runStatus === 'cancelled' && (!finalState || !existingInputToolCall)) return
    if (existingIndex >= 0) parts[existingIndex] = nextPart
    else parts.push(nextPart)

    const after = await refreshNativeHarnessAccess(access, context, progress.toolName, accessOptions)
    if (after.runStatus === 'cancelled' && (!finalState || !existingInputToolCall)) return
    await persistAgentToolProgress({
      store,
      actorUserId: access.actorUserId,
      conversationId: access.conversationId,
      messageId: access.assistantMessageId,
      parts,
      workspaceId: access.workspaceId,
    })
  } catch (error) {
    logger.warn('[harness] native tool progress write failed', {
      runId: access.runId,
      toolCallId: progress.toolCallId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
