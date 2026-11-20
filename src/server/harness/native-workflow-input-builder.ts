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
import type { AgentRun } from '@/shared/agents/agent-run'
import type { ThreadWork } from '@/shared/agents/thread-work'
import { threadWorkInstructions } from '@/server/agents/thread-work/thread-work-prompt'

import { ConvexThreadWorkRepository } from '@/server/agents/thread-work/ConvexThreadWorkRepository'

/** The computer and folders an agent thread chose, if any (internal/develop/thread-folders.md). */
function chosenWork(work: ThreadWork | null): ThreadWork | undefined {
  return work && (work.computer || work.folders.length > 0) ? work : undefined
}

type NativeInputArgs = {
  actorUserId: string
  workspaceId: string
  conversationId: string
  runId: string
  memoryEnabled: boolean
  parentRunId?: string
  threadRootMessageId?: string
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

async function prepareNativeRoomInputs(
  args: NativeInputArgs,
  run: AgentRun,
  inheritedSharedRoom: boolean,
  work: ThreadWork | undefined,
): Promise<PreparedWorkspaceInputs> {
  return await prepareWorkspaceAgentInputs({
    // The thread's computer decides which tools the model is offered, not only where they run.
    ...(work ? { work } : {}),
    actorUserId: run.userId,
    agentId: run.agentId!,
    conversationId: run.conversationId,
    messageId: run.userMessageId!,
    memoryEnabled: args.memoryEnabled,
    workspaceId: args.workspaceId,
    includeAutoRetrieval: false,
    inheritedSharedRoom,
  })
}

function assertPreparedRoomIdentity(
  args: NativeInputArgs,
  run: AgentRun,
  prepared: PreparedWorkspaceInputs,
): void {
  const triggeringMessage = prepared.room.history.find(message => message._id === run.userMessageId)
  // An outside agent (joined over MCP) has no Overlay run to be a parent, so a turn its message starts is opened
  // for the person it acts for: the message is the agent's, the initiator is that person.
  const fromOutsideAgent = () => triggeringMessage?.authorKind === 'agent'
    && prepared.room.directory.agents.some(agent => agent.principalId === triggeringMessage.authorPrincipalId
      && agent.harness === 'mcp' && !agent.archivedAt)
  const validTriggerAuthor = (triggeringMessage?.authorKind === 'human' || triggeringMessage?.authorKind === 'agent')
    && (triggeringMessage.authorPrincipalId === run.initiatorPrincipalId || fromOutsideAgent())
  if (!prepared.room.conversation.workspaceId || prepared.room.conversation.workspaceId !== args.workspaceId
    || prepared.agent.harness !== 'overlay' || prepared.agent.principalId !== run.agentPrincipalId
    || !validTriggerAuthor) {
    throw new Error('The native agent room identity changed.')
  }
}

function buildNativeWorkflowInput(
  args: NativeInputArgs,
  run: AgentRun,
  prepared: PreparedWorkspaceInputs,
  inheritedSharedRoom: boolean,
  work: ThreadWork | undefined,
  workBlock: string,
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
      ...(work ? { work, agentName: prepared.agent.name } : {}),
    },
    definitions: prepared.toolDefinitions,
    instructions: buildAgentSystemPrompt({
      agentName: prepared.agent.name,
      agentRole: prepared.agent.agentRole,
      contextBlock: prepared.turnContext.contextBlock,
      exposedToolIds: prepared.toolDefinitions.map(definition => definition.name),
      hasTools: prepared.toolDefinitions.length > 0,
      instructions: prepared.agent.instructions,
      isDefaultMaster: Boolean(prepared.agent.isDefault),
    }) + (workBlock ? `\n\n${workBlock}` : ''),
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
  const repository = new ConvexHarnessRepository()
  // A sub-run inherits its parent's restrictions; a root run keeps those already recorded for it; a new root starts
  // from its conversation's.
  const roomRestrictions = await (args.parentRunId
    ? repository.refreshRoomContextRestrictions({ actorUserId: args.actorUserId, runId: args.parentRunId })
    : run.harnessRunId
      ? repository.get({ actorUserId: args.actorUserId, runId: run.harnessRunId }).then(() =>
        repository.refreshRoomContextRestrictions({ actorUserId: args.actorUserId, runId: run.harnessRunId! }))
      : repository.resolveConversationRoomRestrictions({
        actorUserId: args.actorUserId, workspaceId: args.workspaceId, conversationId: args.conversationId,
      }))
  const inheritedSharedRoom = roomRestrictions.inheritedSharedRoom
  // A thread whose choices can't be read runs as before, without folders, rather than failing the turn.
  const work = chosenWork(await new ConvexThreadWorkRepository().getWork(run.conversationId).catch((_error: unknown) => null))
  const prepared = await prepareNativeRoomInputs(args, run, inheritedSharedRoom, work)
  assertPreparedRoomIdentity(args, run, prepared)
  const workBlock = work ? await threadWorkInstructions({ work, workspaceId: args.workspaceId, actorUserId: run.userId }) : ''
  return buildNativeWorkflowInput(args, run, prepared, inheritedSharedRoom, work, workBlock)
}
