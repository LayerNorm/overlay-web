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
import type { PersonalHarnessModelRouting } from './personal-model-ports'
import { fallbackNoticeText } from '@/server/app-api/v1/conversations/act/route-helpers'
import { harnessDiagnosticForFailure, harnessDiagnosticTerminalError } from './harness-diagnostics'
import { harnessDiagnosticMessage } from '@overlay/agent-runtime/harness-diagnostic'

export async function writePersonalHarnessFallback(
  access: PersonalHarnessAccess,
  event: Parameters<NonNullable<PersonalHarnessModelRouting['onFallback']>>[0],
): Promise<string> {
  'use step'
  const state = await new ConvexHarnessRepository().get(access)
  if (!state || state.parentRunId || state.workflowRunId !== access.workflowRunId || state.status !== 'running'
    || state.latestReceipt?.id !== event.receiptId || state.latestReceipt.modelId !== event.from
    || state.latestReceipt.rejectionReason !== event.reason) throw new FatalError('Invalid fallback delivery authority.')
  const notice = fallbackNoticeText([{ modelId: event.from, reason: event.reason === 'budget' ? 'budget' : 'provider' }], event.to)
  const writer = getWritable<ModelCallStreamPart<ToolSet>>().getWriter()
  const id = `harness-fallback:${event.receiptId}`
  try {
    await writer.write({ type: 'text-start', id })
    await writer.write({ type: 'text-delta', id, text: `${notice}\n\n` })
    await writer.write({ type: 'text-end', id })
  } finally {
    writer.releaseLock()
  }
  return notice
}

export async function attachPersonalHarnessDelivery(access: PersonalHarnessAccess): Promise<void> {
  'use step'
  const state = await new ConvexHarnessRepository().get(access)
  if (!state || state.parentRunId || state.workflowRunId !== access.workflowRunId) throw new FatalError('Invalid root delivery authority.')
  const current = await getOverlayServerContext().appData.repositories.conversations.getLatestAgentRun({
    conversationId: asConversationId(access.conversationId), userId: access.actorUserId, agentRunId: access.agentRunId,
  })
  if (!current || current.id !== access.agentRunId || current.userId !== access.actorUserId
    || current.conversationId !== access.conversationId || current.harnessRunId !== state.runId
    || current.runner !== 'workflow' || current.executionEngine !== 'overlay_harness' || current.mode === 'room'
    || (current.workflowRunId && current.workflowRunId !== access.workflowRunId)) throw new FatalError('Invalid personal delivery run.')
  const run = await agentRunService.attachWorkflow({
    runId: access.agentRunId, userId: access.actorUserId, workflowRunId: access.workflowRunId,
  })
  if (!run || run.conversationId !== access.conversationId || run.harnessRunId !== state.runId
    || run.runner !== 'workflow' || run.executionEngine !== 'overlay_harness'
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
    || run.runner !== 'workflow' || run.executionEngine !== 'overlay_harness' || run.mode === 'room') throw new FatalError('Personal delivery ownership changed.')
  if (run.status === 'cancelled' || run.status === 'failed') return
  if (state.status === 'completed' && state.diagnostic?.code !== 'PERSISTENCE_FAILED') {
    // Every model/summary receipt was already billed by the model ports.
    const { diagnostic: _diagnostic, ...completion } = delivery
    const completed = await agentRunService.complete({ ...completion, runId: access.agentRunId, userId: access.actorUserId })
    if (options.emitWebhook && completed?.status === 'completed') {
      const { emitChatCompleted } = await import('@/server/shared/webhooks')
      emitChatCompleted({
        userId: access.actorUserId, conversationId: access.conversationId, turnId: options.turnId,
        modelId: delivery.routedModelId,
      })
    }
  } else if (state.status === 'failed' || state.status === 'cancelled'
    || (state.status === 'completed' && state.diagnostic?.code === 'PERSISTENCE_FAILED')) {
    if (state.status === 'cancelled') {
      await server.appData.repositories.conversations.transitionAgentRun({
        runId: access.agentRunId, userId: access.actorUserId, status: 'cancelled', expectedWorkflowRunId: access.workflowRunId,
      })
      return
    }
    const diagnostic = harnessDiagnosticForFailure(state.runId, state, new Error(state.terminalReason ?? ''), 'delivery')
    const reason = harnessDiagnosticMessage(diagnostic)
    await agentRunService.fail({
      runId: access.agentRunId, userId: access.actorUserId, errorText: reason,
      expectedWorkflowRunId: access.workflowRunId,
      failureTranscript: { content: delivery.content, parts: delivery.parts },
      error: harnessDiagnosticTerminalError(diagnostic),
      metrics: delivery.metrics,
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
