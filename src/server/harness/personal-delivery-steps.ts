import 'server-only'

import { FatalError, getWritable } from 'workflow'
import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { ToolSet } from 'ai'
import { getOverlayServerContext } from '@/server/bootstrap'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { agentRunService } from '@/server/conversations/http'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { PersonalHarnessAccess } from './personal-access'
import type { buildPersonalHarnessDelivery } from './personal-delivery'

export async function attachPersonalHarnessDelivery(access: PersonalHarnessAccess): Promise<void> {
  'use step'
  const state = await new ConvexHarnessRepository().get(access)
  if (!state || state.parentRunId || state.workflowRunId !== access.workflowRunId) throw new FatalError('Invalid root delivery authority.')
  const current = await getOverlayServerContext().appData.repositories.conversations.getLatestAgentRun({
    conversationId: asConversationId(access.conversationId), userId: access.actorUserId, agentRunId: access.agentRunId,
  })
  if (!current || current.id !== access.agentRunId || current.userId !== access.actorUserId
    || current.conversationId !== access.conversationId || current.harnessRunId !== state.runId
    || current.runner !== 'workflow' || current.mode === 'room'
    || (current.workflowRunId && current.workflowRunId !== access.workflowRunId)) throw new FatalError('Invalid personal delivery run.')
  const run = await agentRunService.attachWorkflow({
    runId: access.agentRunId, userId: access.actorUserId, workflowRunId: access.workflowRunId,
  })
  if (!run || run.conversationId !== access.conversationId || run.harnessRunId !== state.runId
    || run.runner !== 'workflow'
    || run.workflowRunId !== access.workflowRunId || run.mode === 'room') throw new FatalError('Invalid personal delivery run.')
}

export async function finishPersonalHarnessDelivery(
  access: PersonalHarnessAccess,
  delivery: ReturnType<typeof buildPersonalHarnessDelivery>,
  options: { emitWebhook: boolean; turnId: string },
): Promise<void> {
  'use step'
  const state = await new ConvexHarnessRepository().get(access)
  if (!state || state.parentRunId || state.workflowRunId !== access.workflowRunId) throw new FatalError('Invalid root delivery authority.')
  const server = getOverlayServerContext()
  const run = await server.appData.repositories.conversations.getLatestAgentRun({
    conversationId: asConversationId(access.conversationId), userId: access.actorUserId, agentRunId: access.agentRunId,
  })
  if (!run || run.id !== access.agentRunId || run.userId !== access.actorUserId || run.conversationId !== access.conversationId
    || run.harnessRunId !== state.runId || run.workflowRunId !== access.workflowRunId
    || run.runner !== 'workflow' || run.mode === 'room') throw new FatalError('Personal delivery ownership changed.')
  if (run.status === 'cancelled' || run.status === 'failed') return
  if (state.status === 'completed') {
    // Every model/summary receipt was already billed by the model ports.
    const completed = await agentRunService.complete({ ...delivery, runId: access.agentRunId, userId: access.actorUserId })
    if (options.emitWebhook && completed?.status === 'completed') {
      const { emitChatCompleted } = await import('@/server/shared/webhooks')
      emitChatCompleted({
        userId: access.actorUserId, conversationId: access.conversationId, turnId: options.turnId,
        modelId: delivery.routedModelId,
      })
    }
  } else if (state.status === 'failed' || state.status === 'cancelled') {
    if (state.status === 'cancelled') {
      await server.appData.repositories.conversations.transitionAgentRun({
        runId: access.agentRunId, userId: access.actorUserId, status: 'cancelled', expectedWorkflowRunId: access.workflowRunId,
      })
      return
    }
    const reason = state.terminalReason || 'The harness could not complete this task.'
    await agentRunService.recordProgress({ content: delivery.content, runId: access.agentRunId, userId: access.actorUserId })
    await agentRunService.fail({
      runId: access.agentRunId, userId: access.actorUserId, errorText: reason,
      error: { code: 'harness_failed', message: reason, retryable: true }, metrics: delivery.metrics,
    })
  } else {
    throw new FatalError('Cannot finalize an active harness delivery.')
  }
}

export async function closePersonalHarnessStream(error?: string): Promise<void> {
  'use step'
  const writable = getWritable<ModelCallStreamPart<ToolSet>>()
  const writer = writable.getWriter()
  try {
    if (error) await writer.write({ type: 'error', error: new Error(error) } as unknown as ModelCallStreamPart<ToolSet>)
    await writer.close()
  } finally {
    writer.releaseLock()
  }
}
