import 'server-only'

import { FatalError } from 'workflow'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { AgentRun } from '@/shared/agents/agent-run'
import { isSharedRoom } from '@/shared/agents/room-access'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { getOverlayServerContext } from '@/server/bootstrap'
import { assertUserCanUseByokModel } from '@/server/ai/model-runtime'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import { agentModelAttempts, loadRoomTurnContext } from '@/server/agents/workspace-agent-invocation'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { actEntitlementService } from '@/server/conversations/http'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'

export type NativeHarnessAccess = HarnessExecutionReference & {
  workspaceId: string
  principalId: string
  agentId: string
  agentPrincipalId: string
  conversationId: string
  agentRunId: string
  userMessageId: string
  assistantMessageId: string
  turnId: string
}

export type NativeHarnessContext = {
  modelId: string
  memoryEnabled: boolean
  sharedRoom: boolean
  requestFingerprint: string
}

function assertActiveAuthority(access: NativeHarnessAccess, state: HarnessSnapshot | null): asserts state is HarnessSnapshot {
  if (!state?.workflowRunId || state.policy.actorUserId !== access.actorUserId
    || state.policy.workspaceId !== access.workspaceId || state.policy.deadlineAt <= Date.now()
    || ['completed', 'failed', 'cancelled'].includes(state.status)) {
    throw new FatalError('Native harness execution is no longer authorized.')
  }
}

async function readNativeAuthority(access: NativeHarnessAccess, toolName?: string) {
  const repository = new ConvexHarnessRepository()
  const state = await repository.get(access)
  assertActiveAuthority(access, state)
  if (state.workflowRunId !== access.workflowRunId || state.status !== 'running') {
    throw new FatalError('Native harness execution is not owned by this workflow.')
  }
  if (toolName && !state.policy.allowedToolIds.includes(toolName)) {
    throw new FatalError('Tool is outside this harness run\'s capabilities.')
  }
  const root = state.parentRunId ? await repository.get({ actorUserId: access.actorUserId, runId: state.rootRunId }) : state
  assertActiveAuthority(access, root)
  const deliveryRunId = `workspace:${access.agentRunId}`
  let delivery = state
  const visited = new Set<string>()
  while (delivery.runId !== deliveryRunId) {
    if (!delivery.parentRunId || visited.has(delivery.runId) || visited.size >= 8) {
      throw new FatalError('Native delivery does not own this descendant.')
    }
    visited.add(delivery.runId)
    const parent = await repository.get({ actorUserId: access.actorUserId, runId: delivery.parentRunId })
    assertActiveAuthority(access, parent)
    if (parent.rootRunId !== state.rootRunId || parent.depth !== delivery.depth - 1) {
      throw new FatalError('Native harness lineage changed.')
    }
    delivery = parent
  }
  return { state, delivery }
}

function assertNativeDelivery(access: NativeHarnessAccess, state: HarnessSnapshot, delivery: HarnessSnapshot, run: AgentRun | null): void {
  if (!run || run.id !== access.agentRunId || run.userId !== access.actorUserId
    || run.conversationId !== access.conversationId || run.agentId !== access.agentId
    || run.agentPrincipalId !== access.agentPrincipalId || run.turnId !== access.turnId
    || run.userMessageId !== access.userMessageId || run.assistantMessageId !== access.assistantMessageId) {
    throw new FatalError('Native delivery identity changed.')
  }
  if (run.runner !== 'workflow' || run.executionEngine !== 'overlay_harness' || run.mode !== 'room'
    || run.harnessRunId !== delivery.runId || run.workflowRunId !== delivery.workflowRunId
    || (run.status !== 'running' && !(state.runId !== delivery.runId
      && ['waiting_for_input', 'waiting_for_approval', 'waiting_for_children'].includes(run.status)))) {
    throw new FatalError('Native delivery execution changed.')
  }
}

function assertRoomIdentity(access: NativeHarnessAccess, context: NativeHarnessContext, room: Awaited<ReturnType<typeof loadRoomTurnContext>>) {
  const agent = room.directory.agents.find(candidate => candidate.id === access.agentId)
  if (!agent || agent.archivedAt || agent.harness !== 'overlay' || agent.principalId !== access.agentPrincipalId
    || room.conversation.workspaceId !== access.workspaceId || room.conversation.deletedAt
    || (room.conversation.conversationType ?? 'personal') === 'personal') {
    throw new FatalError('Native agent or room access changed.')
  }
  const human = room.participants.some(participant => participant.principalId === access.principalId && participant.principalType === 'human')
  const author = room.participants.some(participant => participant.principalId === access.agentPrincipalId && participant.principalType === 'agent')
  if (!human || !author) throw new FatalError('Native room participation was revoked.')
  const shared = isSharedRoom({
    conversationType: room.conversationType,
    channelVisibility: (room.conversation as { channelVisibility?: string | null }).channelVisibility,
    humanParticipants: room.participants.filter(participant => participant.principalType === 'human').length,
  })
  if (shared && !context.sharedRoom) throw new FatalError('Room visibility changed; private context cannot be reused.')
  if (!agentModelAttempts(agent.modelId).includes(context.modelId)) {
    throw new FatalError('The model is no longer an admitted native agent candidate.')
  }
  return agent
}

async function assertNativeCapabilities(access: NativeHarnessAccess, context: NativeHarnessContext, toolName?: string): Promise<void> {
  const authorization = getOverlayServerContext().authorizationService
  const subject = await authorization.resolveSubject(access.actorUserId)
  const required: Array<Parameters<typeof authorization.checkResolvedCapability>[1]> = ['conversations.edit']
  if (toolName) required.push('tools.use')
  if (context.memoryEnabled) required.push('memory.use')
  if (toolName && ['web_search', 'web_fetch', 'deep_search'].includes(toolName)) required.push('web_search.use')
  if (toolName && ['search_mcp_tools', 'call_mcp_tool'].includes(toolName)) required.push('mcp.use')
  for (const capability of required) {
    if (!authorization.checkResolvedCapability(subject, capability).allowed) throw new FatalError('Native harness permissions were revoked.')
  }
  if (!(await authorization.checkResolvedCatalogResourceAccess({
    capability: 'models.use', resourceId: context.modelId, resourceType: 'model', subject,
  })).allowed) throw new FatalError('Native harness model permission was revoked.')
}

// This returns fresh, in-process authority, never a durable permission snapshot.
export async function refreshNativeHarnessAccess(access: NativeHarnessAccess, context: NativeHarnessContext, toolName?: string) {
  const { state, delivery } = await readNativeAuthority(access, toolName)
  const server = getOverlayServerContext()
  const [room, workspace, run] = await Promise.all([
    loadRoomTurnContext({ actorUserId: access.actorUserId, workspaceId: access.workspaceId,
      conversationId: access.conversationId, messageId: access.userMessageId }),
    server.workspaceService.resolveActiveWorkspace(access.actorUserId, access.workspaceId),
    server.appData.repositories.conversations.getLatestAgentRun({
      conversationId: asConversationId(access.conversationId), userId: access.actorUserId, agentRunId: access.agentRunId,
    }),
  ])
  if (workspace.workspace.id !== access.workspaceId || workspace.principal.id !== access.principalId) {
    throw new FatalError('Native workspace identity changed.')
  }
  assertNativeDelivery(access, state, delivery, run)
  const agent = assertRoomIdentity(access, context, room)
  await assertNativeCapabilities(access, context, toolName)
  const gate = await actEntitlementService.gateModelPolicy({ effectiveModelId: context.modelId,
    userId: access.actorUserId, workspaceId: access.workspaceId, programmaticSubjectId: `agent:${access.agentId}` })
  if (isByokModelId(context.modelId)) {
    await assertUserCanUseByokModel(context.modelId, access.actorUserId)
  } else if (!(await resolveAuthorizedModelIds({ entitlements: gate.runtimeEntitlements })).chat.has(context.modelId)) {
    throw new FatalError('The native model is no longer allowed by server policy.')
  }
  return { agent, latestUserText: room.latestUserText, entitlements: gate.runtimeEntitlements, paid: gate.paid,
    requiresZeroDataRetention: gate.paid && gate.appSettings?.onlyAllowZdrModels === true }
}
