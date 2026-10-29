import 'server-only'

import { asSchema } from 'ai'
import { ActEntitlementService } from '@/server/conversations/ActEntitlementService'
import { getOverlayServerContext } from '@/server/bootstrap'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import { buildWorkspaceAgentTooling } from './agent-tooling'
import { buildAgentTurnContext } from './agent-turn-context'
import { sanitizeWorkflowToolSchemaValue } from '@/server/conversations/personal-chat-work-tools'
import { agentModelAttempts, loadRoomTurnContext } from './workspace-agent-invocation'

export function workspaceAgentInvocationIdentity(messageId: string, agentId: string) {
  const invocationNonce = `agent:${messageId}:${agentId}`
  return {
    invocationNonce,
    requestFingerprint: hashOperationalIdentifier('workspace-agent-invocation', invocationNonce),
    turnId: `agent_${messageId}_${agentId}`,
  }
}

export async function prepareWorkspaceAgentInputs(input: {
  actorUserId: string
  agentId: string
  conversationId: string
  messageId: string
  memoryEnabled: boolean
  workspaceId: string
  includeAutoRetrieval?: boolean
}) {
  const room = await loadRoomTurnContext(input)
  const agent = room.directory.agents.find(candidate => candidate.id === input.agentId)
  if (!agent || agent.archivedAt) throw new Error('The agent is no longer available.')
  const server = getOverlayServerContext()
  const identity = workspaceAgentInvocationIdentity(input.messageId, input.agentId)
  const entitlementService = new ActEntitlementService({
    repository: server.appData.repositories.conversations,
    usagePolicy: server.chatUsagePolicy,
  })
  let gate: Awaited<ReturnType<ActEntitlementService['gateModelAccess']>> | undefined
  let modelId = agent.modelId
  for (const attempt of agentModelAttempts(agent.modelId)) {
    try {
      gate = await entitlementService.gateModelAccess({
        effectiveModelId: attempt,
        programmaticSubjectId: `agent:${agent.id}`,
        userId: input.actorUserId,
        workspaceId: input.workspaceId,
      })
      modelId = attempt
      break
    } catch (_error) { /* fallback to the next entitled model */ }
  }
  if (!gate) throw new Error('No agent model attempt succeeded')
  const tooling = await buildWorkspaceAgentTooling({
    actorUserId: input.actorUserId,
    agentPrincipalId: agent.principalId,
    conversationId: input.conversationId,
    effectiveModelId: modelId,
    entitlements: gate.runtimeEntitlements,
    grant: { agentId: agent.id, allowedToolIds: agent.allowedToolIds, isDefaultMaster: Boolean(agent.isDefault || agent.name.toLowerCase() === 'overlay') },
    approvalMode: agent.harness === 'overlay' && agent.permissionMode === 'auto' ? 'auto' : 'ask',
    computerApprovalContext: 'work',
    idempotencyKey: identity.invocationNonce,
    latestUserText: room.latestUserText,
    memoryEnabled: input.memoryEnabled,
    paid: gate.paid,
    requestFingerprint: identity.requestFingerprint,
    turnId: identity.turnId,
    workspaceId: input.workspaceId,
  })
  const turnContext = await buildAgentTurnContext({
    actorUserId: input.actorUserId,
    agentName: agent.name,
    agentPrincipalId: agent.principalId,
    billingProgrammaticSubjectId: `agent:${agent.id}`,
    channelVisibility: (room.conversation as { channelVisibility?: string | null }).channelVisibility,
    conversationTitle: room.conversation.title,
    conversationType: room.conversationType,
    history: room.history,
    idempotencyKey: `${identity.invocationNonce}:context`,
    latestUserText: room.latestUserText,
    memoryEnabled: input.memoryEnabled,
    participants: room.participants.map(participant => ({ displayName: participant.displayName, principalId: participant.principalId, principalType: participant.principalType })),
    requestFingerprint: identity.requestFingerprint,
    workspaceId: input.workspaceId,
    includeAutoRetrieval: input.includeAutoRetrieval,
  })
  const toolDefinitions = await Promise.all(Object.entries(tooling.tools).map(async ([name, definition]) => ({
    name,
    description: typeof definition.description === 'string' ? definition.description : undefined,
    needsApproval: Boolean(definition.needsApproval),
    inputSchema: sanitizeWorkflowToolSchemaValue(await asSchema(definition.inputSchema).jsonSchema) as Record<string, unknown>,
  })))
  return {
    room,
    agent,
    gate,
    tooling,
    modelId,
    modelCandidates: agentModelAttempts(agent.modelId),
    turnContext,
    toolDefinitions,
    ...identity,
  }
}
