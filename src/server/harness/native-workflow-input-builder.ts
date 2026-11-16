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
  work: ThreadWork | undefined,
  workBlock: string,
): NativeHarnessWorkflowInput {
  const room = prepared.room
  const sharedRoom = isSharedRoom({
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
      contextBlock: surfaceExecution
        ? `This request arrived through Slack in the channel bound to this agent. Treat the imported user message as the complete task request. Do not promise that Slack replies will resume an Overlay input or approval wait.\n\n${prepared.turnContext.contextBlock}`
        : prepared.turnContext.contextBlock,
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
  const surfaceExecution = await loadSurfaceExecution(args, run)
  const prepared = await prepareNativeRoomInputs(args, run, surfaceExecution)
  assertPreparedRoomIdentity(args, run, prepared)
  // Slack turns and threads without choices keep today's behavior.
  // A thread whose choices can't be read runs as before, without folders, rather than failing the turn.
  const work = surfaceExecution ? undefined
    : chosenWork(await new ConvexThreadWorkRepository().getWork(run.conversationId).catch((_error: unknown) => null))
  const workBlock = work ? await threadWorkInstructions({ work, workspaceId: args.workspaceId, actorUserId: run.userId }) : ''
  return buildNativeWorkflowInput(args, run, surfaceExecution, prepared, work, workBlock)
}
