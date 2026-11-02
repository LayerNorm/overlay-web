import 'server-only'

import { FatalError } from 'workflow'
import { getOverlayServerContext } from '@/server/bootstrap'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { isHarnessBackendReady } from '@/server/harness/backend-readiness'
import {
  assertSurfaceAdmissionSource,
  assertSurfaceConversation,
} from '@/server/harness/surface-access'
import { surfaceHarnessTurnId, type SurfaceHarnessAuthentication } from '@/server/harness/surface-authority'
import type { SurfaceAgentTurnInput } from './surface-agent-turn'
import type { SurfaceTurnContext } from '@/server/automations/automation-turn-runner'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'

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
      modelId: source.agent.modelId ?? DEFAULT_MODEL_ID,
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
