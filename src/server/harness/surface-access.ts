import 'server-only'

import { FatalError } from 'workflow'
import { getOverlayServerContext } from '@/server/bootstrap'
import { resolveAgentGrant } from '@/server/agents/agent-tooling'
import { agentMemoryOwnerId } from '@/shared/agents/agent-memory'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import type { PersonalHarnessAccess } from './personal-access'
import { surfaceHarnessTurnId, type SurfaceHarnessIdentity } from './surface-authority'

type ServerContext = ReturnType<typeof getOverlayServerContext>
type SurfaceSource = Awaited<ReturnType<ServerContext['surfaceService']['resolveInboundBindings']>>[number]
type Conversation = Awaited<ReturnType<ServerContext['appData']['repositories']['conversations']['getConversationById']>>
type GrantContext = Pick<PersonalChatWorkToolingContext,
  'turnId' | 'accountAllowedToolIds' | 'accountAllowedConnectorIds' | 'integrationToolIds'>

function assertSourceBinding(source: SurfaceSource | undefined, input: {
  actorUserId: string
  workspaceId: string
  surface: SurfaceHarnessIdentity
}): asserts source is SurfaceSource {
  const expected = input.surface
  if (!source || source.binding.status !== 'active' || source.connection.status !== 'active'
    || source.connection.id !== expected.connectionId || source.connection.workspaceId !== input.workspaceId
    || source.binding.connectionId !== expected.connectionId || source.binding.channelId !== expected.channelId
    || source.binding.agentId !== expected.agentId || source.agent.id !== expected.agentId
    || source.agent.harness !== 'overlay' || source.agent.archivedAt || !source.agent.principalId
    || source.creatorUserId !== input.actorUserId
    || (expected.agentPrincipalId && source.agent.principalId !== expected.agentPrincipalId)
    || (expected.creatorPrincipalId && source.creatorPrincipalId !== expected.creatorPrincipalId)) {
    throw new FatalError('The surface binding or agent authorization changed.')
  }
}

export async function assertSurfaceAdmissionSource(input: {
  actorUserId: string
  workspaceId: string
  turnId: string
  surface: SurfaceHarnessIdentity
}): Promise<SurfaceSource> {
  const surface = input.surface
  if (surface.platform !== 'slack' || !surface.bindingId || !surface.connectionId || !surface.teamId
    || !surface.channelId || !surface.threadId || !surface.messageId || !surface.agentId
    || input.turnId !== surfaceHarnessTurnId(surface)) {
    throw new FatalError('Surface source identity is invalid.')
  }
  const server = getOverlayServerContext()
  const candidates = await server.surfaceService.resolveInboundBindings({
    platform: 'slack', externalTeamId: surface.teamId, channelId: surface.channelId,
  })
  const source = candidates.find(candidate => candidate.binding.id === surface.bindingId)
  assertSourceBinding(source, input)
  const workspace = await server.workspaceService.resolveActiveWorkspace(input.actorUserId, input.workspaceId)
  if (workspace.workspace.id !== input.workspaceId || workspace.principal.id !== source.creatorPrincipalId) {
    throw new FatalError('Surface workspace authority changed.')
  }
  return source
}

export function assertSurfaceConversation(input: {
  actorUserId: string
  workspaceId: string
  principalId: string
  surface: SurfaceHarnessIdentity
}, conversation: Conversation): void {
  if (!conversation || conversation.userId !== input.actorUserId || conversation.deletedAt != null
    || conversation.workspaceId !== input.workspaceId || conversation.conversationType !== 'channel'
    || conversation.createdByPrincipalId !== input.principalId
    || conversation.externalPlatform !== input.surface.platform
    || conversation.externalChannelId !== input.surface.channelId
    || conversation.externalThreadId !== input.surface.threadId
    || conversation.surfaceBindingId !== input.surface.bindingId) {
    throw new FatalError('Surface conversation ownership changed.')
  }
}

export async function refreshSurfaceHarnessSource(
  access: PersonalHarnessAccess,
  context: GrantContext,
  rootWorkflowRunId: string,
) {
  const authority = access.authentication
  if (authority.type !== 'surface') throw new FatalError('Surface authentication is required.')
  if (authority.originWorkflowRunId !== rootWorkflowRunId || context.turnId !== surfaceHarnessTurnId(authority)) {
    throw new FatalError('Surface workflow ownership changed.')
  }
  const source = await assertSurfaceAdmissionSource({
    actorUserId: access.actorUserId, workspaceId: access.workspaceId,
    turnId: context.turnId, surface: authority,
  })
  if (source.creatorPrincipalId !== access.principalId) throw new FatalError('Surface principal changed.')
  const conversations = getOverlayServerContext().appData.repositories.conversations
  const [conversation, run] = await Promise.all([
    conversations.getConversationById({
      conversationId: asConversationId(access.conversationId), userId: access.actorUserId, workspaceId: access.workspaceId,
    }),
    conversations.getLatestAgentRun({
      conversationId: asConversationId(access.conversationId), userId: access.actorUserId, agentRunId: access.agentRunId,
    }),
  ])
  assertSurfaceConversation({ ...access, surface: authority }, conversation)
  if (!run || run.id !== access.agentRunId || run.userId !== access.actorUserId
    || run.conversationId !== access.conversationId || run.turnId !== context.turnId
    || run.workflowRunId !== authority.originWorkflowRunId
    || run.executionEngine !== 'overlay_harness' || run.runner !== 'workflow' || run.mode === 'room') {
    throw new FatalError('Surface delivery ownership changed.')
  }
  return surfaceSourceGrant(source, context)
}

function surfaceSourceGrant(source: SurfaceSource, context: GrantContext) {
  const grant = resolveAgentGrant({
    agentId: source.agent.id, allowedToolIds: source.agent.allowedToolIds, isDefaultMaster: source.agent.isDefault === true,
  })
  const integrations = grant.capabilities.has('integrations')
  return {
    approvalMode: source.agent.permissionMode === 'auto' ? 'auto' as const : 'ask' as const,
    allowedToolIds: [
      ...(context.accountAllowedToolIds ?? []).filter(id => grant.overlayToolIds.includes(id)),
      ...(integrations ? context.integrationToolIds ?? [] : []),
    ],
    allowedConnectorIds: integrations ? context.accountAllowedConnectorIds ?? [] : [],
    memoryOwnerId: agentMemoryOwnerId(source.agent.id),
  }
}
