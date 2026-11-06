import 'server-only'

import type { NativeHarnessWorkflowInput } from './native-workflow-input'
import type { HarnessModelSettings } from './ports'
import type { WorkspaceAgentReasoningLevel } from '@overlay/workspace-contracts'
import { buildAgentSystemPrompt } from '@/server/agents/workspace-agent-invocation'
import { prepareWorkspaceAgentInputs } from '@/server/agents/workspace-agent-preparation'
import { getOverlayServerContext } from '@/server/bootstrap'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { isSharedRoom } from '@/shared/agents/room-access'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { assertPersistedSurfaceSource } from './surface-access'
import type { AgentRun } from '@/shared/agents/agent-run'
import type { SurfaceTurnExecution } from '@/shared/agents/surface-turn-execution'

type NativeInputArgs = {
  actorUserId: string
  workspaceId: string
  conversationId: string
  runId: string
  memoryEnabled: boolean
  parentRunId?: string
  threadRootMessageId?: string
  surfaceRootRunId?: string
  expectedSurfaceWorkflowRunId?: string
}
type PreparedWorkspaceInputs = Awaited<ReturnType<typeof prepareWorkspaceAgentInputs>>

export function nativeWorkflowSettingsForReasoning(
  reasoning?: WorkspaceAgentReasoningLevel,
): HarnessModelSettings | undefined {
  return reasoning && reasoning !== 'provider-default' ? { reasoning } : undefined
}

function assertNativeRunIdentity(run: AgentRun | null, args: NativeInputArgs): asserts run is AgentRun {
  if (!run || run.id !== args.runId || run.userId !== args.actorUserId
    || run.conversationId !== args.conversationId || run.mode !== 'room'
    || run.runner !== 'workflow' || run.executionEngine !== 'overlay_harness'
    || !run.agentId || !run.agentPrincipalId || !run.initiatorPrincipalId) {
    throw new Error('The native agent run identity is unavailable.')
  }
}

async function loadSurfaceExecution(args: NativeInputArgs, run: AgentRun): Promise<SurfaceTurnExecution | null> {
  const execution = await new ConvexHarnessRepository()
    .getSurfaceExecutionByHarnessRunId(args.surfaceRootRunId ?? `workspace:${run.id}`)
  if (!execution) return null
  const ownsDelivery = execution.actorUserId === args.actorUserId
    && execution.workspaceId === args.workspaceId
    && (execution.agentRunId !== run.id || (
      execution.conversationId === args.conversationId
      && execution.turnId === run.turnId
      && execution.userMessageId === run.userMessageId
      && execution.assistantMessageId === run.assistantMessageId
    ))
  if (!ownsDelivery) throw new Error('The persisted surface source does not own this native delivery.')
  await assertPersistedSurfaceSource(execution, args.expectedSurfaceWorkflowRunId)
  return execution
}

async function prepareNativeRoomInputs(
  args: NativeInputArgs,
  run: AgentRun,
  execution: SurfaceTurnExecution | null,
  inheritedSharedRoom: boolean,
): Promise<PreparedWorkspaceInputs> {
  const isSurfaceRoot = execution?.agentRunId === run.id
  return await prepareWorkspaceAgentInputs({
    actorUserId: run.userId,
    agentId: run.agentId!,
    conversationId: run.conversationId,
    messageId: run.userMessageId!,
    memoryEnabled: args.memoryEnabled,
    workspaceId: args.workspaceId,
    includeAutoRetrieval: false,
    inheritedSharedRoom,
    ...(execution ? {
      ...(isSurfaceRoot ? {
        turnIdOverride: execution.turnId,
        requestFingerprintOverride: `surface:${execution.turnId}`,
      } : {}),
      billingProgrammaticSubjectId: `surface:slack:${execution.bindingId}`,
    } : {}),
  })
}

function assertPreparedRoomIdentity(
  args: NativeInputArgs,
  run: AgentRun,
  prepared: PreparedWorkspaceInputs,
): void {
  const triggeringMessage = prepared.room.history.find(message => message._id === run.userMessageId)
  const validTriggerAuthor = (triggeringMessage?.authorKind === 'human' || triggeringMessage?.authorKind === 'agent')
    && triggeringMessage.authorPrincipalId === run.initiatorPrincipalId
  if (!prepared.room.conversation.workspaceId || prepared.room.conversation.workspaceId !== args.workspaceId
    || prepared.agent.harness !== 'overlay' || prepared.agent.principalId !== run.agentPrincipalId
    || !validTriggerAuthor) {
    throw new Error('The native agent room identity changed.')
  }
}

function buildNativeWorkflowInput(
  args: NativeInputArgs,
  run: AgentRun,
  surfaceExecution: SurfaceTurnExecution | null,
  prepared: PreparedWorkspaceInputs,
  inheritedSharedRoom: boolean,
): NativeHarnessWorkflowInput {
  const room = prepared.room
  const sharedRoom = inheritedSharedRoom || isSharedRoom({
    conversationType: room.conversationType,
    channelVisibility: (room.conversation as { channelVisibility?: string | null }).channelVisibility,
    humanParticipants: room.participants.filter(participant => participant.principalType === 'human').length,
  })
  const settings = nativeWorkflowSettingsForReasoning(prepared.agent.reasoning)
  return {
    access: {
      actorUserId: run.userId,
      runId: `workspace:${run.id}`,
      workspaceId: room.conversation.workspaceId!,
      principalId: run.initiatorPrincipalId!,
      agentId: run.agentId!,
      agentPrincipalId: run.agentPrincipalId!,
      conversationId: run.conversationId,
      agentRunId: run.id,
      userMessageId: run.userMessageId!,
      assistantMessageId: run.assistantMessageId!,
      turnId: run.turnId!,
    },
    context: {
      modelId: prepared.modelId,
      memoryEnabled: args.memoryEnabled,
      sharedRoom,
      requestFingerprint: prepared.requestFingerprint,
    },
    definitions: prepared.toolDefinitions,
    instructions: buildAgentSystemPrompt({
      agentName: prepared.agent.name,
      agentRole: prepared.agent.agentRole,
      contextBlock: surfaceExecution
        ? `This request arrived through Slack in the channel bound to this agent. Treat the imported user message as the complete task request. Do not promise that Slack replies will resume an Overlay input or approval wait.\n\n${prepared.turnContext.contextBlock}`
        : prepared.turnContext.contextBlock,
      exposedToolIds: prepared.toolDefinitions.map(definition => definition.name),
      hasTools: prepared.toolDefinitions.length > 0,
      instructions: prepared.agent.instructions,
      isDefaultMaster: Boolean(prepared.agent.isDefault),
    }),
    messages: prepared.turnContext.messages,
    ...(settings ? { settings } : {}),
  }
}

export async function buildNativeHarnessWorkflowInput(args: NativeInputArgs): Promise<NativeHarnessWorkflowInput> {
  const server = getOverlayServerContext()
  const run = await server.appData.repositories.conversations.getLatestAgentRun({
    agentRunId: args.runId,
    conversationId: asConversationId(args.conversationId),
    userId: args.actorUserId,
  })
  assertNativeRunIdentity(run, args)
  const [surfaceExecution, roomRestrictions] = await Promise.all([
    loadSurfaceExecution(args, run),
    new ConvexHarnessRepository().refreshRoomContextRestrictions({
      actorUserId: args.actorUserId,
      runId: args.parentRunId ?? run.harnessRunId ?? `workspace:${run.id}`,
    }),
  ])
  const inheritedSharedRoom = roomRestrictions.inheritedSharedRoom
  const prepared = await prepareNativeRoomInputs(args, run, surfaceExecution, inheritedSharedRoom)
  assertPreparedRoomIdentity(args, run, prepared)
  return buildNativeWorkflowInput(args, run, surfaceExecution, prepared, inheritedSharedRoom)
}
