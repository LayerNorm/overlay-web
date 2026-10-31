import { FatalError, getWorkflowMetadata } from 'workflow'
import type { AutomationAgentTurnInput } from '@/server/automations/automation-turn-runner'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import { assertPersistedSurfaceSource } from '@/server/harness/surface-access'
import { prepareNativeHarnessTurn } from '@/server/harness/native-turn-start'
import { postSlackAgentMessage } from '@/server/surfaces/slack-reply'
import { ensureSurfaceConversation } from '@/server/surfaces/surface-conversations'
import type { SurfaceTurnExecution } from '@/shared/agents/surface-turn-execution'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { nativeHarnessWorkflow } from './native-harness'
import { admitSurfaceSourceStep, assertSurfaceConversationStep } from './surface-harness-steps'

export type SurfaceAgentTurnInput = Omit<AutomationAgentTurnInput, 'surface' | 'workspaceId'> & {
  workspaceId: string
  surface: NonNullable<AutomationAgentTurnInput['surface']>
}

async function ensureSurfaceConversationStep(input: SurfaceAgentTurnInput) {
  'use step'
  return await ensureSurfaceConversation(input)
}

async function beginNativeSurfaceTurnStep(input: {
  turnInput: SurfaceAgentTurnInput
  workflowRunId: string
  conversationId: string
}) {
  'use step'
  return await new ConvexHarnessRepository().beginSurfaceTurn({
    turnId: input.turnInput.turnId,
    workflowRunId: input.workflowRunId,
    actorUserId: input.turnInput.userId,
    workspaceId: input.turnInput.workspaceId,
    creatorPrincipalId: input.turnInput.surface.creatorPrincipalId!,
    agentId: input.turnInput.surface.agentId,
    agentPrincipalId: input.turnInput.surface.agentPrincipalId!,
    platform: 'slack',
    teamId: input.turnInput.surface.teamId,
    channelId: input.turnInput.surface.channelId,
    threadId: input.turnInput.surface.threadId,
    messageId: input.turnInput.surface.messageId,
    bindingId: input.turnInput.surface.bindingId,
    connectionId: input.turnInput.surface.connectionId,
    conversationId: input.conversationId,
    userContent: input.turnInput.instructions,
    importedAuthorName: input.turnInput.surface.authorName,
    importedAuthorEmail: input.turnInput.surface.authorEmail,
    importedAuthorStatus: input.turnInput.surface.authorStatus,
    modelId: input.turnInput.modelId ?? DEFAULT_MODEL_ID,
    placeholderTs: input.turnInput.surface.placeholderTs,
  })
}

async function prepareNativeSurfaceStep(input: {
  actorUserId: string
  workspaceId: string
  conversationId: string
  runId: string
  workflowRunId: string
}) {
  'use step'
  try {
    const prepared = await prepareNativeHarnessTurn({
      ...input,
      memoryEnabled: true,
      expectedSurfaceWorkflowRunId: input.workflowRunId,
    })
    if (!prepared) return { ok: false as const, message: 'Native Harness preparation returned no workflow input.' }
    return { ok: true as const, workflowInput: prepared.workflowInput }
  } catch (_error) {
    return { ok: false as const, message: 'Native Harness preparation or admission failed.' }
  }
}

async function recordNativeSurfaceFailureStep(input: {
  execution: SurfaceTurnExecution
  workflowRunId: string
}) {
  'use step'
  return await new ConvexHarnessRepository().failOwnedSurfaceTurn({
    turnId: input.execution.turnId,
    workflowRunId: input.workflowRunId,
    agentRunId: input.execution.agentRunId,
    assistantMessageId: input.execution.assistantMessageId,
  })
}

async function readNativeSurfaceResultStep(input: {
  execution: SurfaceTurnExecution
  workflowRunId: string
}) {
  'use step'
  const repository = getOverlayServerContext().appData.repositories.conversations
  const run = await repository.getLatestAgentRun({
    userId: input.execution.actorUserId,
    conversationId: input.execution.conversationId as never,
    agentRunId: input.execution.agentRunId,
  })
  if (!run || run.id !== input.execution.agentRunId
    || run.assistantMessageId !== input.execution.assistantMessageId
    || run.harnessRunId !== input.execution.harnessRunId
    || (run.workflowRunId && run.workflowRunId !== input.workflowRunId)) {
    return { status: 'unavailable', text: '' }
  }
  const messages = await repository.getConversationMessages({
    userId: input.execution.actorUserId,
    conversationId: input.execution.conversationId as never,
  })
  return {
    status: run.status,
    text: messages.find(message => message._id === input.execution.assistantMessageId)?.content ?? '',
  }
}

async function postNativeSurfaceResultStep(input: {
  execution: SurfaceTurnExecution
  status: string
  workflowRunId: string
  preparationFailure?: boolean
}) {
  'use step'
  if (!['completed', 'failed', 'cancelled'].includes(input.status)) return { posted: false }
  try {
    const repository = new ConvexHarnessRepository()
    const current = await repository.getSurfaceExecutionByHarnessRunId(input.execution.harnessRunId)
    if (!current || current.turnId !== input.execution.turnId
      || current.workflowRunId !== input.workflowRunId
      || current.agentRunId !== input.execution.agentRunId
      || current.assistantMessageId !== input.execution.assistantMessageId) return { posted: false }
    const { source, run } = await assertPersistedSurfaceSource(current, input.workflowRunId)
    const state = await repository.get({ actorUserId: current.actorUserId, runId: current.harnessRunId })
    if ((!input.preparationFailure && (!state || state.workflowRunId !== current.workflowRunId
        || state.status !== input.status))
      || (state && state.workflowRunId !== current.workflowRunId)
      || run.status !== input.status || !current.placeholderTs) return { posted: false }
    const messages = await getOverlayServerContext().appData.repositories.conversations.getConversationMessages({
      conversationId: current.conversationId as never,
      userId: current.actorUserId,
    })
    const content = messages.find(message => message._id === current.assistantMessageId)?.content ?? ''
    if (input.status === 'completed' && !content) return { posted: false }
    const { getSlackAdapter } = await import(
      /* step-only */ '@/server/surfaces/chat'
    )
    const text = input.status === 'cancelled'
      ? 'This task was cancelled in Overlay.'
      : input.status === 'failed'
        ? 'This task failed in Overlay. Open the conversation for details.'
        : content
    const result = await postSlackAgentMessage({
      adapter: await getSlackAdapter(),
      teamId: current.teamId,
      channelId: current.channelId,
      threadTs: current.threadId || undefined,
      text,
      agentName: source.agent.name,
      editTs: current.placeholderTs,
    })
    return { posted: result.posted }
  } catch (_error) {
    return { posted: false }
  }
}

export async function surfaceAgentTurnWorkflow(input: SurfaceAgentTurnInput) {
  'use workflow'
  const { workflowRunId } = getWorkflowMetadata()
  if (input.automationId || input.runId) throw new FatalError('Surface turns cannot carry automation identity.')
  const admitted = await admitSurfaceSourceStep(input, workflowRunId)
  const ensured = await ensureSurfaceConversationStep(admitted.turnInput)
  const authorizedInput = {
    ...admitted.turnInput,
    conversationId: ensured.conversationId,
    workspaceId: ensured.workspaceId,
  }
  await assertSurfaceConversationStep(authorizedInput)
  const begun = await beginNativeSurfaceTurnStep({
    turnInput: authorizedInput,
    workflowRunId,
    conversationId: ensured.conversationId,
  })
  if (begun.owner === 'foreign' || !begun.execution) {
    return { status: 'already_running', deliveryStatus: 'not_attempted' }
  }
  const execution = begun.execution
  const previous = await readNativeSurfaceResultStep({ execution, workflowRunId })
  if (['completed', 'failed', 'cancelled'].includes(previous.status)) {
    const delivery = await postNativeSurfaceResultStep({ execution, status: previous.status, workflowRunId })
    return {
      status: previous.status,
      deliveryStatus: delivery.posted ? 'posted' : 'not_attempted',
    }
  }
  const prepared = await prepareNativeSurfaceStep({
    actorUserId: authorizedInput.userId,
    workspaceId: authorizedInput.workspaceId,
    conversationId: ensured.conversationId,
    runId: execution.agentRunId,
    workflowRunId,
  })
  if (!prepared.ok) {
    const failure = await recordNativeSurfaceFailureStep({ execution, workflowRunId })
    if (failure.persisted) await postNativeSurfaceResultStep({
      execution, status: 'failed', workflowRunId, preparationFailure: true,
    })
    throw new FatalError(prepared.message)
  }
  const nativeResult = await nativeHarnessWorkflow(prepared.workflowInput)
  const terminal = await readNativeSurfaceResultStep({ execution, workflowRunId })
  if (!['completed', 'failed', 'cancelled'].includes(terminal.status)
    || nativeResult.status !== terminal.status) {
    return { status: nativeResult.status, deliveryStatus: 'not_attempted' }
  }
  const delivery = await postNativeSurfaceResultStep({
    execution,
    status: terminal.status,
    workflowRunId,
  })
  return {
    status: terminal.status,
    deliveryStatus: delivery.posted ? 'posted' : 'not_attempted',
  }
}
