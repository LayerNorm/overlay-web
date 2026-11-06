import 'server-only'

import { FatalError } from 'workflow'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { WorkspaceAccess } from '@overlay/workspace-contracts'
import type { AgentRun } from '@/shared/agents/agent-run'
import { isSharedRoom } from '@/shared/agents/room-access'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { getOverlayServerContext } from '@/server/bootstrap'
import { assertUserCanUseByokModel } from '@/server/ai/model-runtime'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import { loadRoomTurnContext } from '@/server/agents/workspace-agent-invocation'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { actEntitlementService } from '@/server/conversations/http'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { assertPersistedSurfaceSource } from './surface-access'
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

function nativeOwnerMatches(access: NativeHarnessAccess, state: HarnessSnapshot): boolean {
  const ownerTransferInProgress = state.runId !== access.runId
    && state.policy.executionPolicyVersion === 2 && !state.workflowRunId && Boolean(state.handoffWorkflowRunId)
    && !['completed', 'cancelled', 'failed'].includes(state.status)
  return !(!state.workflowRunId && !ownerTransferInProgress) && state.policy.actorUserId === access.actorUserId
    && state.policy.workspaceId === access.workspaceId
    && !(state.runId === access.runId && (state.executionGeneration ?? 0) !== (access.executionGeneration ?? 0))
}

function nativeDeadlineAllows(
  access: NativeHarnessAccess,
  state: HarnessSnapshot,
  allowCancelledToolProgress: boolean,
  renewalMode: boolean,
): boolean {
  const cancelledToolProgress = allowCancelledToolProgress && state.runId === access.runId && state.status === 'cancelled'
  return !((state.policy.deadlineAt <= Date.now() && !cancelledToolProgress
    && !(renewalMode && state.policy.executionPolicyVersion === 2))
    || (state.policy.taskDeadlineAt !== undefined && state.policy.taskDeadlineAt <= Date.now()
      && !cancelledToolProgress && !renewalMode))
}

function nativeStatusAllows(access: NativeHarnessAccess, state: HarnessSnapshot, allowCancelledToolProgress: boolean): boolean {
  const cancelledToolProgress = allowCancelledToolProgress && state.runId === access.runId && state.status === 'cancelled'
  return !(['completed', 'failed'].includes(state.status)
    || (state.status === 'cancelled' && !cancelledToolProgress))
}

function hasActiveNativeAuthority(
  access: NativeHarnessAccess,
  state: HarnessSnapshot | null,
  allowCancelledToolProgress = false,
  renewalMode = false,
): boolean {
  if (!state) return false
  return nativeOwnerMatches(access, state)
    && nativeDeadlineAllows(access, state, allowCancelledToolProgress, renewalMode)
    && nativeStatusAllows(access, state, allowCancelledToolProgress)
}

function assertActiveAuthority(
  access: NativeHarnessAccess,
  state: HarnessSnapshot | null,
  allowCancelledToolProgress = false,
  renewalMode = false,
): asserts state is HarnessSnapshot {
  if (!hasActiveNativeAuthority(access, state, allowCancelledToolProgress, renewalMode)) {
    throw new FatalError('Native harness execution is no longer authorized.')
  }
}

function assertNativeDeliveryIdentity(access: NativeHarnessAccess, run: AgentRun | null): asserts run is AgentRun {
  if (!run || run.id !== access.agentRunId || run.userId !== access.actorUserId
    || run.conversationId !== access.conversationId || run.agentId !== access.agentId
    || run.agentPrincipalId !== access.agentPrincipalId || run.turnId !== access.turnId
    || run.userMessageId !== access.userMessageId || run.assistantMessageId !== access.assistantMessageId) {
    throw new FatalError('Native delivery identity changed.')
  }
}

function nativeDeliveryIsCurrent(
  access: NativeHarnessAccess,
  state: HarnessSnapshot,
  delivery: HarnessSnapshot,
  run: AgentRun,
  allowCancelledToolProgress: boolean,
  renewalMode: boolean,
): boolean {
  const deliveryOwner = delivery.workflowRunId ?? delivery.handoffWorkflowRunId
  const cancelledToolProgress = allowCancelledToolProgress && state.runId === access.runId && state.status === 'cancelled'
  return run.runner === 'workflow' && run.executionEngine === 'overlay_harness' && run.mode === 'room'
    && Boolean(deliveryOwner) && run.harnessRunId === delivery.runId && run.workflowRunId === deliveryOwner
    && (run.status === 'running' || (state.runId !== delivery.runId
      && ['waiting_for_input', 'waiting_for_approval', 'waiting_for_children', 'waiting_for_resources'].includes(run.status))
      || (renewalMode && state.runId === delivery.runId
        && ['waiting_for_resources', 'waiting_for_input', 'waiting_for_approval', 'waiting_for_children'].includes(state.status)
        && run.status === state.status)
      || (cancelledToolProgress && run.status === 'cancelled'))
}

async function readNativeAuthority(
  access: NativeHarnessAccess,
  toolName?: string,
  allowCancelledToolProgress = false,
  renewalMode = false,
) {
  const repository = new ConvexHarnessRepository()
  const state = await repository.get(access)
  assertActiveAuthority(access, state, allowCancelledToolProgress, renewalMode)
  if (state.workflowRunId !== access.workflowRunId
    || (state.status !== 'running' && !(renewalMode
      && ['waiting_for_resources', 'waiting_for_input', 'waiting_for_approval', 'waiting_for_children'].includes(state.status))
      && !(allowCancelledToolProgress && state.status === 'cancelled'))) {
    throw new FatalError('Native harness execution is not owned by this workflow.')
  }
  if (toolName && !state.policy.allowedToolIds.includes(toolName)) {
    throw new FatalError('Tool is outside this harness run\'s capabilities.')
  }
  const root = state.parentRunId ? await repository.get({ actorUserId: access.actorUserId, runId: state.rootRunId }) : state
  assertActiveAuthority(access, root, allowCancelledToolProgress && root?.runId === state.runId, renewalMode)
  const deliveryRunId = `workspace:${access.agentRunId}`
  let delivery = state
  const visited = new Set<string>()
  while (delivery.runId !== deliveryRunId) {
    if (!delivery.parentRunId || visited.has(delivery.runId) || visited.size >= 8) {
      throw new FatalError('Native delivery does not own this descendant.')
    }
    visited.add(delivery.runId)
    const parent = await repository.get({ actorUserId: access.actorUserId, runId: delivery.parentRunId })
    assertActiveAuthority(access, parent, false, renewalMode)
    if (parent.rootRunId !== state.rootRunId || parent.depth !== delivery.depth - 1) {
      throw new FatalError('Native harness lineage changed.')
    }
    delivery = parent
  }
  return { state, delivery }
}

function assertNativeDelivery(
  access: NativeHarnessAccess,
  state: HarnessSnapshot,
  delivery: HarnessSnapshot,
  run: AgentRun | null,
  allowCancelledToolProgress = false,
  renewalMode = false,
): void {
  assertNativeDeliveryIdentity(access, run)
  if (!nativeDeliveryIsCurrent(access, state, delivery, run, allowCancelledToolProgress, renewalMode)) {
    throw new FatalError('Native delivery execution changed.')
  }
}

type NativeRoomTurnContext = Awaited<ReturnType<typeof loadRoomTurnContext>>

function hasActiveOverlayAgentParticipant(room: NativeRoomTurnContext, principalId: string): boolean {
  const agent = room.directory.agents.some(candidate => candidate.principalId === principalId
    && !candidate.archivedAt && candidate.harness === 'overlay')
  const participant = room.participants.some(candidate => candidate.principalId === principalId
    && candidate.principalType === 'agent')
  return agent && participant
}

function parentMatchesNamedChild(
  access: NativeHarnessAccess,
  state: HarnessSnapshot,
  parent: HarnessSnapshot | null,
): boolean {
  return Boolean(state.parentRunId && state.runId === access.runId && parent
    && parent.runId === state.parentRunId
    && parent.policy.actorUserId === access.actorUserId
    && parent.policy.workspaceId === access.workspaceId)
}

async function resolveHumanPrincipalId(
  access: NativeHarnessAccess,
  state: HarnessSnapshot,
  workspace: WorkspaceAccess,
  room: NativeRoomTurnContext,
): Promise<string> {
  const humanPrincipalId = workspace.principal.id
  if (workspace.workspace.id !== access.workspaceId || workspace.principal.type !== 'human') {
    throw new FatalError('Native workspace identity changed.')
  }
  if (access.principalId === humanPrincipalId) return humanPrincipalId
  if (!state.parentRunId || state.runId !== access.runId || access.principalId === access.agentPrincipalId) {
    throw new FatalError('Native workspace identity changed.')
  }
  const parent = await new ConvexHarnessRepository().get({
    actorUserId: access.actorUserId,
    runId: state.parentRunId,
  })
  if (!parentMatchesNamedChild(access, state, parent)
    || !hasActiveOverlayAgentParticipant(room, access.principalId)) {
    throw new FatalError('Native workspace identity changed.')
  }
  return humanPrincipalId
}

function assertRoomIdentity(
  access: NativeHarnessAccess,
  context: NativeHarnessContext,
  room: NativeRoomTurnContext,
  humanPrincipalId: string,
  inheritedSharedRoom: boolean,
) {
  const agent = room.directory.agents.find(candidate => candidate.id === access.agentId)
  if (!agent || agent.archivedAt || agent.harness !== 'overlay' || agent.principalId !== access.agentPrincipalId
    || room.conversation.workspaceId !== access.workspaceId || room.conversation.deletedAt
    || (room.conversation.conversationType ?? 'personal') === 'personal') {
    throw new FatalError('Native agent or room access changed.')
  }
  const human = room.participants.some(participant => participant.principalId === humanPrincipalId && participant.principalType === 'human')
  const author = room.participants.some(participant => participant.principalId === access.agentPrincipalId && participant.principalType === 'agent')
  if (!human || !author) throw new FatalError('Native room participation was revoked.')
  const shared = inheritedSharedRoom || isSharedRoom({
    conversationType: room.conversationType,
    channelVisibility: (room.conversation as { channelVisibility?: string | null }).channelVisibility,
    humanParticipants: room.participants.filter(participant => participant.principalType === 'human').length,
  })
  if (shared && !context.sharedRoom) throw new FatalError('Room visibility changed; private context cannot be reused.')
  if (agent.modelId !== context.modelId) {
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
export async function refreshNativeHarnessAccess(
  access: NativeHarnessAccess,
  context: NativeHarnessContext,
  toolName?: string,
  options: { allowCancelledToolProgress?: boolean; renewalMode?: boolean; renewLease?: boolean } = {},
) {
  const allowCancelledToolProgress = options.allowCancelledToolProgress === true && Boolean(toolName)
  if (options.renewLease && !options.renewalMode) throw new FatalError('Invalid lease renewal mode.')
  const { state, delivery } = await readNativeAuthority(access, toolName, allowCancelledToolProgress, options.renewalMode)
  const server = getOverlayServerContext()
  const root = state.rootRunId === state.runId
    ? state
    : await new ConvexHarnessRepository().get({ actorUserId: access.actorUserId, runId: state.rootRunId })
  if (!root) throw new FatalError('Native harness root is unavailable.')
  const surfaceExecution = await new ConvexHarnessRepository()
    .getSurfaceExecutionByHarnessRunId(root.runId)
  if (surfaceExecution) {
    if (root.runId !== surfaceExecution.harnessRunId
      || root.workflowRunId !== surfaceExecution.workflowRunId
      || root.policy.actorUserId !== surfaceExecution.actorUserId
      || root.policy.workspaceId !== surfaceExecution.workspaceId
      || access.actorUserId !== surfaceExecution.actorUserId
      || access.workspaceId !== surfaceExecution.workspaceId) {
      throw new FatalError('Native surface source ownership changed.')
    }
    await assertPersistedSurfaceSource(surfaceExecution, root.workflowRunId)
  }
  const [room, workspace, run, roomRestrictions] = await Promise.all([
    loadRoomTurnContext({ actorUserId: access.actorUserId, workspaceId: access.workspaceId,
      conversationId: access.conversationId, messageId: access.userMessageId }),
    server.workspaceService.resolveActiveWorkspace(access.actorUserId, access.workspaceId),
    server.appData.repositories.conversations.getLatestAgentRun({
      conversationId: asConversationId(access.conversationId), userId: access.actorUserId, agentRunId: access.agentRunId,
    }),
    new ConvexHarnessRepository().refreshRoomContextRestrictions({ actorUserId: access.actorUserId, runId: access.runId }),
  ])
  const humanPrincipalId = await resolveHumanPrincipalId(access, state, workspace, room)
  assertNativeDelivery(access, state, delivery, run, allowCancelledToolProgress, options.renewalMode === true)
  const agent = assertRoomIdentity(access, context, room, humanPrincipalId, roomRestrictions.inheritedSharedRoom)
  await assertNativeCapabilities(access, context, toolName)
  const billingProgrammaticSubjectId = surfaceExecution
    ? `surface:slack:${surfaceExecution.bindingId}`
    : `agent:${access.agentId}`
  const gate = await actEntitlementService.gateModelPolicy({ effectiveModelId: context.modelId,
    userId: access.actorUserId, workspaceId: access.workspaceId, programmaticSubjectId: billingProgrammaticSubjectId })
  if (isByokModelId(context.modelId)) {
    await assertUserCanUseByokModel(context.modelId, access.actorUserId, access.workspaceId)
  } else if (!(await resolveAuthorizedModelIds({ entitlements: gate.runtimeEntitlements })).chat.has(context.modelId)) {
    throw new FatalError('The native model is no longer allowed by server policy.')
  }
  if (options.renewLease && state.policy.executionPolicyVersion === 2) {
    const repository = new ConvexHarnessRepository()
    const current = await repository.get({ actorUserId: access.actorUserId, runId: access.runId })
    if (!current || current.workflowRunId !== access.workflowRunId
      || (current.executionGeneration ?? 0) !== (access.executionGeneration ?? 0)) {
      throw new FatalError('Native harness execution ownership changed during lease renewal.')
    }
    await repository.renewLease({
      actorUserId: access.actorUserId, runId: access.runId, workflowRunId: access.workflowRunId,
      executionGeneration: access.executionGeneration ?? 0, expectedRevision: current.revision,
      now: Date.now(), leaseMs: 24 * 60 * 60 * 1_000,
    })
  }
  return { agent, latestUserText: room.latestUserText, entitlements: gate.runtimeEntitlements, paid: gate.paid,
    billingProgrammaticSubjectId,
    runStatus: state.status,
    requiresZeroDataRetention: gate.paid && gate.appSettings?.onlyAllowZdrModels === true }
}
