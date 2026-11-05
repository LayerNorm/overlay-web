import 'server-only'

import { FatalError } from 'workflow'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { agentMemoryOwnerId } from '@/shared/agents/agent-memory'
import { compactAssistantPersistenceForConvex } from '@/shared/chat/persist-assistant-turn'
import { stripTextualToolCalls, stripTextualToolCallsFromParts } from '@/shared/ai/textual-tool-calls'
import { getOverlayServerContext } from '@/server/bootstrap'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { agentRunService } from '@/server/conversations/http'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { NativeHarnessAccess } from './native-access'
import type { buildPersonalHarnessDelivery } from './personal-delivery'
import { projectHarnessDeliveryWait, type HarnessWaitProjection } from './delivery-wait-projection'
import { postSlackAgentMessage } from '@/server/surfaces/slack-reply'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import { getBaseUrl } from '@/server/web/app-url'
import { assertPersistedSurfaceSource } from './surface-access'
import { harnessDiagnosticForFailure, harnessDiagnosticTerminalError } from './harness-diagnostics'
import { harnessDiagnosticMessage } from '@overlay/agent-runtime/harness-diagnostic'

type Delivery = ReturnType<typeof buildPersonalHarnessDelivery>

function assertNativeDeliveryOwnership(
  access: NativeHarnessAccess,
  state: Awaited<ReturnType<ConvexHarnessRepository['get']>>,
  run: Awaited<ReturnType<ReturnType<typeof getOverlayServerContext>['appData']['repositories']['conversations']['getLatestAgentRun']>>,
  allowUnattached = false,
): asserts state is HarnessSnapshot {
  if (!state || state.runId !== `workspace:${access.agentRunId}` || state.workflowRunId !== access.workflowRunId
    || state.policy.actorUserId !== access.actorUserId || state.policy.workspaceId !== access.workspaceId
    || !run || run.id !== access.agentRunId || run.userId !== access.actorUserId
    || run.conversationId !== access.conversationId || run.agentId !== access.agentId
    || run.agentPrincipalId !== access.agentPrincipalId || run.turnId !== access.turnId
    || run.userMessageId !== access.userMessageId || run.assistantMessageId !== access.assistantMessageId
    || run.mode !== 'room' || run.runner !== 'workflow' || run.executionEngine !== 'overlay_harness'
    || run.harnessRunId !== state.runId
    || (!allowUnattached && run.workflowRunId !== access.workflowRunId)
    || (allowUnattached && run.workflowRunId && run.workflowRunId !== access.workflowRunId)) {
    throw new FatalError('Native delivery ownership changed.')
  }
}

async function readNativeDelivery(access: NativeHarnessAccess) {
  const server = getOverlayServerContext()
  const state = await new ConvexHarnessRepository().get(access)
  const run = await server.appData.repositories.conversations.getLatestAgentRun({
    conversationId: asConversationId(access.conversationId), userId: access.actorUserId, agentRunId: access.agentRunId,
  })
  return { state, run }
}

export async function attachNativeHarnessDelivery(access: NativeHarnessAccess): Promise<void> {
  'use step'
  const { state, run } = await readNativeDelivery(access)
  assertNativeDeliveryOwnership(access, state, run, true)
  const attached = await agentRunService.attachWorkflow({
    runId: access.agentRunId, userId: access.actorUserId, workflowRunId: access.workflowRunId,
  })
  const current = await readNativeDelivery(access)
  assertNativeDeliveryOwnership(access, current.state, current.run)
  if (!attached) throw new FatalError('Native delivery workflow attachment failed.')
}

export async function projectNativeHarnessWait(
  access: NativeHarnessAccess,
  projection: HarnessWaitProjection,
): Promise<'projected' | 'stale' | 'inactive'> {
  'use step'
  const { state, run } = await readNativeDelivery(access)
  assertNativeDeliveryOwnership(access, state, run)
  if (!run) throw new FatalError('Native delivery ownership changed.')
  if (['completed', 'cancelled', 'failed'].includes(state.status)) return 'inactive'
  const result = await projectHarnessDeliveryWait(access, run, projection)
  if (result !== 'projected') return result
  try {
    const repository = new ConvexHarnessRepository()
    if (state.runId !== state.rootRunId) return result
    const execution = await repository.getSurfaceExecutionByHarnessRunId(state.rootRunId)
    if (!execution?.placeholderTs || execution.agentRunId !== access.agentRunId
      || execution.assistantMessageId !== access.assistantMessageId
      || execution.workflowRunId !== state.workflowRunId || run.workflowRunId !== execution.workflowRunId) return result
    const { source, run: sourceRun } = await assertPersistedSurfaceSource(execution, state.workflowRunId)
    if (sourceRun.id !== run.id || sourceRun.assistantMessageId !== execution.assistantMessageId) return result
    if ('wait' in projection) {
      const expected = projection.wait.kind === 'input' ? 'waiting_for_input' : 'waiting_for_approval'
      if (sourceRun.status !== expected) return result
    } else if (sourceRun.status !== projection.status) return result
    const link = `${getBaseUrl()}${buildWorkspaceHref(
      execution.workspaceId,
      `/app/chat?${new URLSearchParams({ id: execution.conversationId, view: 'channels' })}`,
    )}`
    const text = 'wait' in projection
      ? projection.wait.kind === 'approval'
        ? `This task needs approval in Overlay. Open ${link} to approve or deny it; Slack replies will not resume the task.`
        : `This task needs input in Overlay. Open ${link} to respond; Slack replies will not resume the task.`
      : 'Working in Overlay…'
    const { getSlackAdapter } = await import(
      /* step-only */ '@/server/surfaces/chat'
    )
    await postSlackAgentMessage({
      adapter: await getSlackAdapter(),
      teamId: execution.teamId,
      channelId: execution.channelId,
      threadTs: execution.threadId || undefined,
      text,
      agentName: source.agent.name,
      editTs: execution.placeholderTs,
    }).catch((_error) => ({ posted: false }))
  } catch (_error) {
    // Slack projection is best-effort after the durable wait is committed.
  }
  return result
}

export async function finishNativeHarnessDelivery(
  access: NativeHarnessAccess,
  delivery: Delivery,
  options: { memoryEnabled: boolean },
  activeToolNames: ReadonlySet<string> = new Set(),
): Promise<void> {
  'use step'
  const { state, run } = await readNativeDelivery(access)
  assertNativeDeliveryOwnership(access, state, run)
  if (!run) throw new FatalError('Native delivery ownership changed.')
  const server = getOverlayServerContext()
  const sanitizeStreamedMessage = async () => {
    await server.appData.repositories.conversationCollaboration.sanitizeAgentMessageTextParts({
      actorUserId: access.actorUserId, authorPrincipalId: access.agentPrincipalId,
      conversationId: access.conversationId, messageId: access.assistantMessageId,
      toolNames: [...activeToolNames], turnId: access.turnId, workspaceId: access.workspaceId,
    })
  }
  if (run.status === 'cancelled' || run.status === 'failed') {
    await sanitizeStreamedMessage()
    return
  }
  if (state.status === 'completed' && state.diagnostic?.code !== 'PERSISTENCE_FAILED') {
    const persistence = compactAssistantPersistenceForConvex({
      content: stripTextualToolCalls(delivery.content, activeToolNames),
      parts: stripTextualToolCallsFromParts(delivery.parts, activeToolNames)
        .filter(part => (part as { type?: unknown }).type !== 'reasoning'),
    })
    await server.appData.repositories.conversationCollaboration.finalizeAgentMessage({
      actorUserId: access.actorUserId, content: persistence.content, conversationId: access.conversationId,
      messageId: access.assistantMessageId, parts: persistence.parts, tokens: delivery.tokens,
      toolNames: [...activeToolNames], workspaceId: access.workspaceId,
    })
    const { diagnostic: _diagnostic, ...completion } = delivery
    await agentRunService.complete({
      ...completion, content: persistence.content, parts: persistence.parts,
      runId: access.agentRunId, userId: access.actorUserId,
    })
    if (options.memoryEnabled) {
      await server.appData.repositories.conversationCollaboration.enqueueMemoryExtraction({
        actorUserId: access.actorUserId, conversationId: access.conversationId,
        memoryOwnerId: agentMemoryOwnerId(access.agentId), messageId: access.assistantMessageId,
        targetActor: 'agent', turnId: access.turnId, workspaceId: access.workspaceId,
      }).catch((_error) => undefined)
    }
    return
  }
  if (state.status === 'cancelled') {
    await sanitizeStreamedMessage()
    await server.appData.repositories.conversations.transitionAgentRun({
      runId: access.agentRunId, userId: access.actorUserId, status: 'cancelled',
      expectedWorkflowRunId: access.workflowRunId,
    })
    return
  }
  if (state.status === 'failed'
    || (state.status === 'completed' && state.diagnostic?.code === 'PERSISTENCE_FAILED')) {
    const diagnostic = harnessDiagnosticForFailure(state.runId, state, new Error(state.terminalReason ?? ''), 'delivery')
    const reason = harnessDiagnosticMessage(diagnostic)
    let content: string | undefined
    let failureTranscript: { content: string; parts: typeof delivery.parts } | undefined
    try {
      const [message] = await server.appData.repositories.conversationCollaboration.listMessages({
        actorUserId: access.actorUserId, conversationId: access.conversationId, messageId: access.assistantMessageId,
        workspaceId: access.workspaceId, limit: 1,
      })
      if (message && message._id === access.assistantMessageId && message.turnId === access.turnId
        && message.authorKind === 'agent' && message.authorPrincipalId === access.agentPrincipalId
        && (message.status === 'generating' || message.status === 'error')) {
        failureTranscript = { content: delivery.content, parts: delivery.parts }
        if (message.status === 'generating' && !message.content.trim()) {
          content = delivery.content.trim() || reason
        }
      }
    } catch (_error) {
      content = undefined
    }
    await server.appData.repositories.conversationCollaboration.failAgentMessage({
      actorUserId: access.actorUserId, conversationId: access.conversationId,
      messageId: access.assistantMessageId, toolNames: [...activeToolNames],
      runId: access.agentRunId, workflowRunId: access.workflowRunId,
      workspaceId: access.workspaceId,
      ...(failureTranscript ? {
        content: delivery.content.trim() || content || '',
        parts: failureTranscript.parts,
      } : {}),
    })
    await agentRunService.fail({
      runId: access.agentRunId, userId: access.actorUserId, errorText: reason,
      expectedWorkflowRunId: access.workflowRunId,
      failureTranscript,
      error: harnessDiagnosticTerminalError(diagnostic),
      metrics: delivery.metrics,
    })
    return
  }
  throw new FatalError('Cannot finalize an active native harness delivery.')
}
