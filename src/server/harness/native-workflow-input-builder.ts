import 'server-only'

import type { NativeHarnessWorkflowInput } from './native-workflow-input'
import { buildAgentSystemPrompt } from '@/server/agents/workspace-agent-invocation'
import { prepareWorkspaceAgentInputs } from '@/server/agents/workspace-agent-preparation'
import { getOverlayServerContext } from '@/server/bootstrap'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { isSharedRoom } from '@/shared/agents/room-access'

export async function buildNativeHarnessWorkflowInput(args: {
  actorUserId: string
  workspaceId: string
  conversationId: string
  runId: string
  memoryEnabled: boolean
  threadRootMessageId?: string
}): Promise<NativeHarnessWorkflowInput> {
  const server = getOverlayServerContext()
  const run = await server.appData.repositories.conversations.getLatestAgentRun({
    agentRunId: args.runId,
    conversationId: asConversationId(args.conversationId),
    userId: args.actorUserId,
  })
  if (!run || run.id !== args.runId || run.userId !== args.actorUserId
    || run.conversationId !== args.conversationId || run.mode !== 'room' || run.runner !== 'workflow'
    || run.executionEngine !== 'overlay_harness' || !run.agentId || !run.agentPrincipalId
    || !run.initiatorPrincipalId) {
    throw new Error('The native agent run identity is unavailable.')
  }

  const prepared = await prepareWorkspaceAgentInputs({
    actorUserId: run.userId,
    agentId: run.agentId,
    conversationId: run.conversationId,
    messageId: run.userMessageId,
    memoryEnabled: args.memoryEnabled,
    workspaceId: args.workspaceId,
    includeAutoRetrieval: false,
  })
  const room = prepared.room
  const triggeringMessage = room.history.find(message => message._id === run.userMessageId)
  if (!room.conversation.workspaceId || room.conversation.workspaceId !== args.workspaceId
    || prepared.agent.harness !== 'overlay' || prepared.agent.principalId !== run.agentPrincipalId
    || triggeringMessage?.authorKind !== 'human'
    || triggeringMessage.authorPrincipalId !== run.initiatorPrincipalId) {
    throw new Error('The native agent room identity changed.')
  }
  const sharedRoom = isSharedRoom({
    conversationType: room.conversationType,
    channelVisibility: (room.conversation as { channelVisibility?: string | null }).channelVisibility,
    humanParticipants: room.participants.filter(participant => participant.principalType === 'human').length,
  })

  return {
    access: {
      actorUserId: run.userId,
      runId: `workspace:${run.id}`,
      workspaceId: room.conversation.workspaceId,
      principalId: run.initiatorPrincipalId,
      agentId: run.agentId,
      agentPrincipalId: run.agentPrincipalId,
      conversationId: run.conversationId,
      agentRunId: run.id,
      userMessageId: run.userMessageId,
      assistantMessageId: run.assistantMessageId,
      turnId: run.turnId,
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
      contextBlock: prepared.turnContext.contextBlock,
      exposedToolIds: prepared.toolDefinitions.map(definition => definition.name),
      hasTools: prepared.toolDefinitions.length > 0,
      instructions: prepared.agent.instructions,
      isDefaultMaster: Boolean(prepared.agent.isDefault || prepared.agent.name.toLowerCase() === 'overlay'),
    }),
    messages: prepared.turnContext.messages,
    modelCandidates: prepared.modelCandidates,
  }
}
