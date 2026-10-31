import 'server-only'

import { FatalError } from 'workflow'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentRunService } from '@/server/conversations/http'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { isHarnessBackendReady } from '@/server/harness/backend-readiness'
import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import { personalHarnessPolicy } from '@/server/harness/personal-admission-policy'
import { harnessToolsRequirePlan } from '@/server/harness/write-tools'
import {
  assertSurfaceAdmissionSource,
  assertSurfaceConversation,
} from '@/server/harness/surface-access'
import { surfaceHarnessTurnId, type SurfaceHarnessAuthentication } from '@/server/harness/surface-authority'
import type { PersonalHarnessAccess } from '@/server/harness/personal-access'
import type { SurfaceAgentTurnInput } from './surface-agent-turn'
import {
  prepareAutomationAgentTurn,
  type AutomationAgentTurnPlan,
  type SurfaceTurnContext,
} from '@/server/automations/automation-turn-runner'

type SurfaceSource = Awaited<ReturnType<ReturnType<typeof getOverlayServerContext>['surfaceService']['resolveInboundBindings']>> extends Array<infer Item>
  ? Item
  : never

function sourceSurfaceContext(
  input: SurfaceAgentTurnInput,
  source: SurfaceSource,
  workflowRunId: string,
): { authority: SurfaceHarnessAuthentication; turnInput: SurfaceAgentTurnInput } {
  const inbound = input.surface
  const authority: SurfaceHarnessAuthentication = {
    type: 'surface',
    platform: 'slack',
    bindingId: inbound.bindingId,
    connectionId: inbound.connectionId,
    teamId: inbound.teamId,
    channelId: inbound.channelId,
    threadId: inbound.threadId,
    messageId: inbound.messageId,
    agentId: source.agent.id,
    agentPrincipalId: source.agent.principalId!,
    creatorPrincipalId: source.creatorPrincipalId,
    originWorkflowRunId: workflowRunId,
  }
  const surface: SurfaceTurnContext = {
    ...inbound,
    platform: 'slack',
    agentId: source.agent.id,
    agentName: source.agent.name,
    agentInstructions: source.agent.instructions,
    agentPrincipalId: source.agent.principalId!,
    agentAllowedToolIds: source.agent.allowedToolIds,
    agentIsDefault: source.agent.isDefault === true,
    agentPermissionMode: source.agent.permissionMode === 'auto' ? 'auto' : 'ask',
    creatorPrincipalId: source.creatorPrincipalId,
  }
  return {
    authority,
    turnInput: {
      ...input,
      userId: source.creatorUserId,
      name: source.agent.name,
      modelId: source.agent.modelId,
      workspaceId: source.connection.workspaceId,
      turnId: surfaceHarnessTurnId(authority),
      surface,
    },
  }
}

export async function admitSurfaceSourceStep(
  input: SurfaceAgentTurnInput,
  workflowRunId: string,
): Promise<{ authority: SurfaceHarnessAuthentication; turnInput: SurfaceAgentTurnInput }> {
  'use step'
  if (input.automationId || input.runId) throw new FatalError('Surface turns cannot carry automation identity.')
  const server = getOverlayServerContext()
  let settings
  try {
    settings = await server.appData.repositories.conversations.getAppSettings({ userId: input.userId })
  } catch (_error) {
    throw new FatalError('Harness backend is unavailable.')
  }
  if (!isHarnessBackendReady(settings)) throw new FatalError('Harness backend is unavailable.')
  const source = await assertSurfaceAdmissionSource({
    actorUserId: input.userId,
    workspaceId: input.workspaceId,
    turnId: input.turnId,
    surface: input.surface,
  })
  return sourceSurfaceContext(input, source, workflowRunId)
}

export async function assertSurfaceConversationStep(
  input: SurfaceAgentTurnInput,
): Promise<void> {
  'use step'
  const conversation = await getOverlayServerContext().appData.repositories.conversations.getConversationById({
    conversationId: asConversationId(input.conversationId!),
    userId: input.userId,
    workspaceId: input.workspaceId,
  })
  assertSurfaceConversation({
    actorUserId: input.userId,
    workspaceId: input.workspaceId!,
    principalId: input.surface.creatorPrincipalId!,
    surface: input.surface,
  }, conversation)
}

export async function prepareSurfaceTurnStep(
  input: SurfaceAgentTurnInput,
  workflowRunId: string,
): Promise<{ turnInput: SurfaceAgentTurnInput; plan: AutomationAgentTurnPlan; authority: SurfaceHarnessAuthentication }> {
  'use step'
  const admitted = await admitSurfaceSourceStep(input, workflowRunId)
  return {
    ...admitted,
    plan: await prepareAutomationAgentTurn({
      ...admitted.turnInput,
      conversationId: input.conversationId!,
      workspaceId: input.workspaceId!,
    }),
  }
}

export async function startSurfaceAgentRunStep(input: {
  conversationId: string
  modelId: string
  turnId: string
  userId: string
  userMessageId: string
}) {
  'use step'
  const run = await agentRunService.startPersonalWorkflow({
    conversationId: input.conversationId as never,
    modelId: input.modelId,
    turnId: input.turnId,
    userId: input.userId,
    userMessageId: input.userMessageId as never,
  })
  if (!run) throw new FatalError('Surface AgentRun could not be admitted.')
  return run
}

export async function admitSurfaceHarnessStep(input: {
  goal: string
  actorUserId: string
  workspaceId: string
  modelId: string
  paid: boolean
  createdAt: number
  allowedToolIds: string[]
  conversationId: string
  deliveryAgentRunId: string
}) {
  'use step'
  return await new ConvexHarnessRepository().admit({
    runId: `personal:${input.deliveryAgentRunId}`,
    goal: input.goal.slice(0, 32_000) || 'Respond to the latest surface message.',
    constraints: [],
    policy: personalHarnessPolicy({
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      allowedToolIds: input.allowedToolIds,
      requiresPlan: harnessToolsRequirePlan(input.allowedToolIds),
      modelId: input.modelId,
      paid: input.paid,
      createdAt: input.createdAt,
    }),
    source: { conversationId: input.conversationId },
    deliveryAgentRunId: input.deliveryAgentRunId,
  })
}

export async function readSurfaceDeliveryStep(input: {
  conversationId: string
  agentRunId: string
  userId: string
  turnId: string
}): Promise<string> {
  'use step'
  const conversations = getOverlayServerContext().appData.repositories.conversations
  const [run, messages] = await Promise.all([
    conversations.getLatestAgentRun({
      conversationId: input.conversationId as never, userId: input.userId, agentRunId: input.agentRunId,
    }),
    conversations.getConversationMessages({
      conversationId: input.conversationId as never, userId: input.userId,
    }),
  ])
  if (!run || run.id !== input.agentRunId || run.userId !== input.userId
    || run.conversationId !== input.conversationId || run.turnId !== input.turnId) return ''
  return messages.find(message => message.role === 'assistant' && message.turnId === input.turnId)?.content ?? ''
}

export function surfaceAccessForDelivery(input: {
  authority: SurfaceHarnessAuthentication
  userId: string
  workspaceId: string
  conversationId: string
  agentRunId: string
  workflowRunId: string
}): PersonalHarnessAccess {
  return {
    actorUserId: input.userId,
    runId: `personal:${input.agentRunId}`,
    workflowRunId: input.workflowRunId,
    conversationId: input.conversationId,
    agentRunId: input.agentRunId,
    workspaceId: input.workspaceId,
    principalId: input.authority.creatorPrincipalId,
    authentication: input.authority,
  }
}
