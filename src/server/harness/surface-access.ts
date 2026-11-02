import 'server-only'

import { FatalError } from 'workflow'
import { getOverlayServerContext } from '@/server/bootstrap'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { surfaceHarnessTurnId, type SurfaceHarnessIdentity } from './surface-authority'
import type { SurfaceTurnExecution } from '@/shared/agents/surface-turn-execution'

type ServerContext = ReturnType<typeof getOverlayServerContext>
type SurfaceSource = Awaited<ReturnType<ServerContext['surfaceService']['resolveInboundBindings']>>[number]
type Conversation = Awaited<ReturnType<ServerContext['appData']['repositories']['conversations']['getConversationById']>>

function assertSourceBinding(source: SurfaceSource | undefined, input: {
  actorUserId: string
  workspaceId: string
  surface: SurfaceHarnessIdentity
}): asserts source is SurfaceSource {
  const expected = input.surface
  if (!source || source.binding.status !== 'active' || source.connection.status !== 'active'
    || source.connection.platform !== 'slack' || source.connection.externalTeamId !== expected.teamId
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

export async function assertPersistedSurfaceSource(
  execution: SurfaceTurnExecution,
  expectedWorkflowRunId?: string,
) {
  if (execution.platform !== 'slack' || execution.turnId !== `surface:slack:${execution.bindingId}:${execution.messageId}`
    || execution.harnessRunId !== `workspace:${execution.agentRunId}`
    || (expectedWorkflowRunId && execution.workflowRunId !== expectedWorkflowRunId)) {
    throw new FatalError('Persisted surface execution identity changed.')
  }
  const identity: SurfaceHarnessIdentity = {
    platform: 'slack', bindingId: execution.bindingId, connectionId: execution.connectionId,
    teamId: execution.teamId, channelId: execution.channelId, threadId: execution.threadId,
    messageId: execution.messageId, agentId: execution.agentId,
    agentPrincipalId: execution.agentPrincipalId, creatorPrincipalId: execution.creatorPrincipalId,
  }
  const source = await assertSurfaceAdmissionSource({
    actorUserId: execution.actorUserId, workspaceId: execution.workspaceId,
    turnId: execution.turnId, surface: identity,
  })
  if (source.agent.principalId !== execution.agentPrincipalId
    || source.creatorPrincipalId !== execution.creatorPrincipalId) {
    throw new FatalError('Persisted surface source principals changed.')
  }
  const server = getOverlayServerContext()
  const [conversation, run] = await Promise.all([
    server.appData.repositories.conversations.getConversationById({
      conversationId: asConversationId(execution.conversationId),
      userId: execution.actorUserId,
      workspaceId: execution.workspaceId,
    }),
    server.appData.repositories.conversations.getLatestAgentRun({
      conversationId: asConversationId(execution.conversationId),
      userId: execution.actorUserId,
      agentRunId: execution.agentRunId,
    }),
  ])
  assertSurfaceConversation({
    actorUserId: execution.actorUserId, workspaceId: execution.workspaceId,
    principalId: execution.creatorPrincipalId, surface: identity,
  }, conversation)
  if (!run || run.id !== execution.agentRunId || run.userId !== execution.actorUserId
    || run.conversationId !== execution.conversationId || run.agentId !== execution.agentId
    || run.agentPrincipalId !== execution.agentPrincipalId
    || run.initiatorPrincipalId !== execution.creatorPrincipalId
    || run.turnId !== execution.turnId || run.userMessageId !== execution.userMessageId
    || run.assistantMessageId !== execution.assistantMessageId || run.harnessRunId !== execution.harnessRunId
    || (run.workflowRunId && run.workflowRunId !== execution.workflowRunId) || run.mode !== 'room'
    || run.runner !== 'workflow' || run.executionEngine !== 'overlay_harness') {
    throw new FatalError('Persisted native surface delivery ownership changed.')
  }
  return { source, conversation, run, identity }
}
