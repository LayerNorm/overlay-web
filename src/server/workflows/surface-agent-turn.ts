/**
 * Surface Agent Turn — source-admitted execution of a Slack message through
 * the shared personal Harness lifecycle.
 */

import { FatalError, getWorkflowMetadata } from 'workflow'
import type {
  AutomationAgentTurnInput,
  SurfaceTurnContext,
} from '@/server/automations/automation-turn-runner'
import { ensureSurfaceConversation } from '@/server/surfaces/surface-conversations'
import { postSlackAgentMessage } from '@/server/surfaces/slack-reply'
import {
  assertSurfaceAdmissionSource,
  assertSurfaceConversation,
  refreshSurfaceHarnessSource,
} from '@/server/harness/surface-access'
import type { SurfaceHarnessAuthentication } from '@/server/harness/surface-authority'
import type { PersonalHarnessAccess } from '@/server/harness/personal-access'
import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import { personalHarnessWorkflow } from './personal-harness'
import {
  admitSurfaceHarnessStep,
  admitSurfaceSourceStep,
  assertSurfaceConversationStep,
  prepareSurfaceTurnStep,
  readSurfaceDeliveryStep,
  startSurfaceAgentRunStep,
  surfaceAccessForDelivery,
} from './surface-harness-steps'

export type SurfaceAgentTurnInput = Omit<
  AutomationAgentTurnInput,
  'surface' | 'workspaceId'
> & {
  workspaceId: string
  surface: SurfaceTurnContext
}

async function ensureSurfaceConversationStep(input: SurfaceAgentTurnInput): Promise<{
  conversationId: string
  workspaceId: string
}> {
  'use step'
  return await ensureSurfaceConversation(input)
}

async function postSurfaceReplyStep(args: {
  authority: SurfaceHarnessAuthentication
  userId: string
  workspaceId: string
  conversationId: string
  workflowRunId: string
  text: string
  editTs?: string
  access?: PersonalHarnessAccess
  context?: Pick<PersonalChatWorkToolingContext,
    'turnId' | 'accountAllowedToolIds' | 'accountAllowedConnectorIds' | 'integrationToolIds'>
}): Promise<{ posted: boolean }> {
  'use step'
  if (args.authority.originWorkflowRunId !== args.workflowRunId) return { posted: false }
  const source = await assertSurfaceAdmissionSource({
    actorUserId: args.userId,
    workspaceId: args.workspaceId,
    turnId: `surface:slack:${args.authority.bindingId}:${args.authority.messageId}`,
    surface: args.authority,
  })
  if (args.access && args.context) {
    await refreshSurfaceHarnessSource(args.access, args.context, args.workflowRunId)
  }
  const server = await import('@/server/bootstrap')
  const conversation = await server.getOverlayServerContext().appData.repositories.conversations.getConversationById({
    conversationId: args.conversationId as never,
    userId: args.userId,
    workspaceId: args.workspaceId,
  })
  assertSurfaceConversation({
    actorUserId: args.userId,
    workspaceId: args.workspaceId,
    principalId: source.creatorPrincipalId,
    surface: args.authority,
  }, conversation)
  if (args.authority.platform !== 'slack') return { posted: false }
  // Keep this dynamic import hidden from workflow bundle discovery. See
  // workflow-imports.test.ts and surfaces/chat.ts.
  const { getSlackAdapter } = await import(
    /* step-only */ '@/server/surfaces/chat'
  )
  const result = await postSlackAgentMessage({
    adapter: await getSlackAdapter(),
    teamId: args.authority.teamId,
    channelId: args.authority.channelId,
    threadTs: args.authority.threadId || undefined,
    text: args.text,
    agentName: source.agent.name,
    editTs: args.editTs,
  }).catch((_error) => ({ posted: false }))
  return { posted: result.posted }
}

function terminalSlackText(status: string, terminalReason?: string): string {
  if (status === 'cancelled') return 'This task was cancelled in Overlay.'
  if (status === 'failed') return 'This task could not complete. Details are available in the Overlay conversation.'
  return terminalReason ? 'Task status is available in the Overlay conversation.' : 'Task status is available in Overlay.'
}

export async function surfaceAgentTurnWorkflow(input: SurfaceAgentTurnInput) {
  'use workflow'

  const { workflowRunId } = getWorkflowMetadata()
  if (input.automationId || input.runId) throw new FatalError('Surface turns cannot carry automation identity.')
  const admittedSource = await admitSurfaceSourceStep(input, workflowRunId)
  const ensured = await ensureSurfaceConversationStep(admittedSource.turnInput)
  const authorizedInput = {
    ...admittedSource.turnInput,
    conversationId: ensured.conversationId,
    workspaceId: ensured.workspaceId,
  }
  await assertSurfaceConversationStep(authorizedInput)

  let prepared
  try {
    prepared = await prepareSurfaceTurnStep(authorizedInput, workflowRunId)
  } catch (error) {
    await postSurfaceReplyStep({
      authority: admittedSource.authority,
      userId: admittedSource.turnInput.userId,
      workspaceId: admittedSource.turnInput.workspaceId,
      conversationId: ensured.conversationId,
      workflowRunId,
      text: 'Sorry — this task could not start. The details are in the Overlay conversation.',
    }).catch((_error) => undefined)
    throw error
  }
  const agentRun = await startSurfaceAgentRunStep({
    conversationId: prepared.plan.conversationId,
    modelId: prepared.plan.effectiveModelId,
    turnId: prepared.turnInput.turnId,
    userId: prepared.turnInput.userId,
    userMessageId: prepared.plan.userMessageId,
  })
  if (agentRun.workflowRunId && agentRun.workflowRunId !== workflowRunId) {
    return { conversationId: prepared.plan.conversationId, status: 'already_running', deliveryStatus: 'not_attempted' }
  }
  const access = surfaceAccessForDelivery({
    authority: prepared.authority,
    userId: prepared.turnInput.userId,
    workspaceId: prepared.turnInput.workspaceId,
    conversationId: prepared.plan.conversationId,
    agentRunId: agentRun.id,
    workflowRunId,
  })
  const admitted = await admitSurfaceHarnessStep({
    goal: prepared.plan.instructions,
    actorUserId: prepared.turnInput.userId,
    workspaceId: prepared.turnInput.workspaceId,
    modelId: prepared.plan.effectiveModelId,
    paid: prepared.plan.paid,
    createdAt: agentRun.createdAt,
    allowedToolIds: prepared.plan.toolDefinitions.map(tool => tool.name),
    conversationId: prepared.plan.conversationId,
    deliveryAgentRunId: agentRun.id,
  })
  if (admitted.workflowRunId && admitted.workflowRunId !== workflowRunId) {
    return { conversationId: prepared.plan.conversationId, status: 'already_running', deliveryStatus: 'not_attempted' }
  }

  if (['completed', 'failed', 'cancelled'].includes(admitted.status)) {
    const content = await readSurfaceDeliveryStep({
      conversationId: prepared.plan.conversationId,
      agentRunId: agentRun.id,
      userId: prepared.turnInput.userId,
      turnId: prepared.turnInput.turnId,
    })
    const replayText = admitted.status === 'completed'
      ? content
      : terminalSlackText(admitted.status, admitted.terminalReason)
    const delivery = replayText ? await postSurfaceReplyStep({
      authority: prepared.authority,
      userId: prepared.turnInput.userId,
      workspaceId: prepared.turnInput.workspaceId,
      conversationId: prepared.plan.conversationId,
      workflowRunId,
      text: replayText,
      editTs: prepared.turnInput.surface.placeholderTs,
      access,
      context: prepared.plan.toolingContext,
    }).catch((_error) => ({ posted: false })) : { posted: false }
    return {
      conversationId: prepared.plan.conversationId,
      status: admitted.status,
      replyText: content,
      deliveryStatus: !replayText ? 'not_attempted' : delivery.posted ? 'posted' : 'failed',
    }
  }

  const result = await personalHarnessWorkflow({
    access,
    context: prepared.plan.toolingContext,
    definitions: prepared.plan.toolDefinitions,
    instructions: prepared.plan.instructions,
    messages: prepared.plan.messages,
    modelCandidates: [prepared.plan.effectiveModelId],
    delivery: {
      emitWebhook: false,
      closeStream: false,
      surface: { placeholderTs: prepared.turnInput.surface?.placeholderTs },
    },
  })
  if (result.status === 'already_running') {
    return { conversationId: prepared.plan.conversationId, status: result.status, deliveryStatus: 'not_attempted' }
  }
  const content = result.status === 'completed'
    ? result.replyText || 'This task completed in Overlay.'
    : terminalSlackText(result.status, result.terminalReason)
  const delivery = await postSurfaceReplyStep({
    authority: prepared.authority,
    userId: prepared.turnInput.userId,
    workspaceId: prepared.turnInput.workspaceId,
    conversationId: prepared.plan.conversationId,
    workflowRunId,
    text: content,
    editTs: prepared.turnInput.surface.placeholderTs,
    access,
    context: prepared.plan.toolingContext,
  }).catch((_error) => ({ posted: false }))
  return { ...result, deliveryStatus: delivery.posted ? 'posted' : 'failed' }
}
