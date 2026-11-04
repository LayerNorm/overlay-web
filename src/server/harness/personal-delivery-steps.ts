import { harnessDiagnosticForFailure, harnessDiagnosticTerminalError } from './harness-diagnostics'
import { harnessDiagnosticMessage } from '@overlay/agent-runtime/harness-diagnostic'
import 'server-only'

import { FatalError, getWritable } from 'workflow'
import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { ToolSet } from 'ai'
import { getOverlayServerContext } from '@/server/bootstrap'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { agentRunService } from '@/server/conversations/http'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { attachPersonalDelivery } from './personal-delivery-attach'
import type { PersonalHarnessAccess } from './personal-access'
import type { buildPersonalHarnessDelivery } from './personal-delivery'

export async function attachPersonalHarnessDelivery(access: PersonalHarnessAccess): Promise<void> {
  'use step'
  await attachPersonalDelivery(access)
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
