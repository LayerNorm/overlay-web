import 'server-only'

import { nativeAgentModelId } from '@/shared/agents/agent-model'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import { resolveMentionFirstInvocations, resolveInvocableAgents } from './mention-policy'
import { agentFormattingNote, computerCapabilityNote, generatedUiNote, knowledgeNote } from '@/server/agent/shared-agent-instructions'
import { SHARED_AGENT_BEHAVIOR_CONSTANTS } from '@/server/agent/shared-agent-instruction-constants'
import { chiefOrchestrationInstructions } from './chief-orchestration'

/**
 * Each mentioned agent gets its own durable run, so an uncapped mass-mention
 * is a cost amplifier.
 */
const MAX_AGENTS_PER_MESSAGE = 20

export const WORKSPACE_AGENT_INVOCATION_REASON_CODES = [
  'room_access_denied',
  'not_a_collaboration_room',
  'no_agent_participant',
  'not_entitled',
  'hosted_runtime_retired',
  'usage_limited',
  'model_failed',
  'empty_response',
] as const

export type WorkspaceAgentInvocationReasonCode =
  typeof WORKSPACE_AGENT_INVOCATION_REASON_CODES[number]

const USER_SAFE_MESSAGES: Record<WorkspaceAgentInvocationReasonCode, string> = {
  room_access_denied: 'You do not have access to this conversation.',
  not_a_collaboration_room: 'Agents can only be mentioned in collaboration rooms.',
  no_agent_participant: 'No available agent participant could be resolved.',
  not_entitled: 'This agent is not available on your current plan.',
  hosted_runtime_retired: 'This hosted Overlay Cloud runtime is retired. Connect a user-owned Agent Host to continue.',
  usage_limited: 'Agent usage is temporarily limited. Try again later.',
  model_failed: 'The agent could not generate a reply. Try again.',
  empty_response: 'The agent returned an empty response. Try again.',
}

export class WorkspaceAgentInvocationError extends Error {
  constructor(
    readonly reasonCode: WorkspaceAgentInvocationReasonCode,
    message = USER_SAFE_MESSAGES[reasonCode],
  ) {
    super(message)
    this.name = 'WorkspaceAgentInvocationError'
  }
}

export function agentModelAttempts(modelId: string): string[] {
  return [modelId]
}

async function loadAccessibleConversation(args: {
  actorUserId: string
  conversationId: string
  workspaceId: string
  collaboration: ConversationCollaborationRepository
  messageId: string
}): Promise<NonNullable<
  Awaited<ReturnType<ConversationCollaborationRepository['getAccessibleConversation']>>
>> {
  try {
    const conversation = await args.collaboration.getAccessibleConversation({
      actorUserId: args.actorUserId,
      conversationId: args.conversationId,
      workspaceId: args.workspaceId,
    })
    if (conversation) return conversation
    logger.warn('[workspace-agent] room access denied', {
      conversationId: args.conversationId,
      reason: 'room_access_denied',
      workspaceId: args.workspaceId,
    })
  } catch (error) {
    logger.error('[workspace-agent] room access denied', {
      conversationId: args.conversationId,
      error,
      messageId: args.messageId,
      reason: 'room_access_denied',
      workspaceId: args.workspaceId,
    })
  }
  throw new WorkspaceAgentInvocationError('room_access_denied')
}

/** One agent that owes a reply to one human message. */
export type WorkspaceAgentInvocation = {
  agentId: string
  agentName: string
  agentPrincipalId: string
  /** Standing instructions. */
  instructions?: string
  /** Idempotency key for this (message, agent) pair. */
  invocationNonce: string
  modelId: string
  effort?: string
  turnId: string
}


/**
 * Everything a room turn reads about the room. Loaded fresh per turn rather
 * than threaded through from the request that triggered it: a durable turn can
 * start long after that request is gone, and the room may have moved on.
 */
export async function loadRoomTurnContext(args: {
  actorUserId: string
  conversationId: string
  messageId: string
  workspaceId: string
}) {
  const server = getOverlayServerContext()
  const collaboration = server.appData.repositories.conversationCollaboration
  const [conversation, participants, history, directory] = await Promise.all([
    loadAccessibleConversation({
    actorUserId: args.actorUserId,
    collaboration,
    conversationId: args.conversationId,
    messageId: args.messageId,
    workspaceId: args.workspaceId,
    }),
    collaboration.listParticipants({
      actorUserId: args.actorUserId, conversationId: args.conversationId, workspaceId: args.workspaceId,
    }),
    collaboration.listMessages({
      actorUserId: args.actorUserId,
      conversationId: args.conversationId,
      limit: 100,
      workspaceId: args.workspaceId,
    }),
    server.workspaceAgentService.list({ actorUserId: args.actorUserId, workspaceId: args.workspaceId }),
  ])
  const conversationType = conversation.conversationType ?? 'personal'
  if (conversationType === 'personal') {
    logger.warn('[workspace-agent] room is not a collaboration room', {
      conversationId: args.conversationId,
      reason: 'not_a_collaboration_room',
      workspaceId: args.workspaceId,
    })
    throw new WorkspaceAgentInvocationError('not_a_collaboration_room')
  }
  const triggeringMessage = history.find((message) => message._id === args.messageId)
  const latestUserText = triggeringMessage?.content
    ?? history.filter((message) => !message.deletedAt).at(-1)?.content
    ?? ''
  return {
    collaboration,
    conversation,
    conversationType,
    directory,
    history,
    latestUserText,
    participants,
    server,
  }
}

/**
 * Which agents owe a reply to a human message, in the order they should run.
 *
 * Split out from execution so the trigger can open a durable run per agent and
 * return, rather than holding a request open for the length of every turn.
 * Agents that already replied to this message are omitted, so a duplicate
 * trigger resolves to nothing rather than answering twice.
 */
export async function resolveWorkspaceAgentInvocations(args: {
  actorUserId: string
  conversationId: string
  messageId: string
  mentionedPrincipalIds?: string[]
  threadRootMessageId?: string
  workspaceId: string
}): Promise<WorkspaceAgentInvocation[]> {
  const server = getOverlayServerContext()
  const collaboration = server.appData.repositories.conversationCollaboration
  const conversation = await loadAccessibleConversation({
    actorUserId: args.actorUserId,
    collaboration,
    conversationId: args.conversationId,
    messageId: args.messageId,
    workspaceId: args.workspaceId,
  })
  const conversationType = conversation.conversationType ?? 'personal'
  if (conversationType === 'personal') {
    throw new WorkspaceAgentInvocationError('not_a_collaboration_room')
  }
  // Deliberately lighter than a turn's own load: this runs on the send path for
  // every room message, including the great majority that address no agent at
  // all. Only a thread reply needs a message read, and only its root.
  const [participants, directory, threadRoot] = await Promise.all([
    collaboration.listParticipants({
      actorUserId: args.actorUserId,
      conversationId: args.conversationId,
      workspaceId: args.workspaceId,
    }),
    server.workspaceAgentService.list({
      actorUserId: args.actorUserId,
      workspaceId: args.workspaceId,
    }),
    args.threadRootMessageId
      ? collaboration.listMessages({
          actorUserId: args.actorUserId,
          conversationId: args.conversationId,
          limit: 1,
          messageId: args.threadRootMessageId,
          workspaceId: args.workspaceId,
        }).then((rows) => rows[0])
      : Promise.resolve(undefined),
  ])
  const principalIds = resolveMentionFirstInvocations({
    authorKind: 'human',
    conversationType,
    participants: participants.map((participant) => ({
      principalId: participant.principalId,
      principalType: participant.principalType,
    })),
    mentionedPrincipalIds: args.mentionedPrincipalIds,
    repliedToAgentPrincipalId: threadRoot?.authorKind === 'agent'
      ? threadRoot.authorPrincipalId
      : undefined,
  })
  if (principalIds.length === 0) {
    logger.warn('[workspace-agent] no agent participant resolved', {
      conversationId: args.conversationId,
      reason: 'no_agent_participant',
      workspaceId: args.workspaceId,
    })
    throw new WorkspaceAgentInvocationError('no_agent_participant')
  }
  // Cap the number of agents that can be invoked per message to prevent
  // cost amplification from mass-mentioning agents. Each agent gets its own
  // run, so without a cap a user could mention many agents and consume
  // significant tokens in a single message.
  if (principalIds.length > MAX_AGENTS_PER_MESSAGE) {
    logger.warn('[workspace-agent] too many agents mentioned, capping', {
      conversationId: args.conversationId,
      count: principalIds.length,
      limit: MAX_AGENTS_PER_MESSAGE,
      workspaceId: args.workspaceId,
    })
  }
  // `directory` holds only agents visible to the triggering actor
  // (WorkspaceAgentService.list filters out creator-only agents anyone else
  // created), so a candidate missing here is either archived or invisible:
  // mentioning it behaves as if the mention had targeted a non-agent, with
  // no error reaching the room that could disclose its existence. This also
  // covers pre-existing DMs after an Everyone → Only me flip, because the
  // directory is read fresh on every trigger.
  const invocableAgents = resolveInvocableAgents({
    candidatePrincipalIds: principalIds.slice(0, MAX_AGENTS_PER_MESSAGE),
    visibleAgents: directory.agents,
  })
  const invocablePrincipalIds = new Set(invocableAgents.map((agent) => agent.principalId))
  for (const principalId of principalIds.slice(0, MAX_AGENTS_PER_MESSAGE)) {
    if (invocablePrincipalIds.has(principalId)) continue
    logger.warn('[workspace-agent] mentioned agent is unavailable', {
      conversationId: args.conversationId,
      principalId,
      reason: 'no_agent_participant',
      workspaceId: args.workspaceId,
    })
  }
  return invocableAgents.map((agent) => ({
    agentId: agent.id,
    agentName: agent.name,
    agentPrincipalId: agent.principalId,
    instructions: agent.instructions,
    invocationNonce: `agent:${args.messageId}:${agent.id}`,
    modelId: nativeAgentModelId(agent.modelId),
    ...(agent.effort ? { effort: agent.effort } : {}),
    turnId: `agent_${args.messageId}_${agent.id}`,
  }))
}


/**
 * Overlay shows an agent's reply with its working details (tool calls and the text written between them) folded
 * away, so what remains visible is what the agent writes last. Asking for a closing summary makes that the answer.
 */
export const AGENT_CLOSING_SUMMARY_INSTRUCTION =
  'When you used tools or worked in several steps, finish your reply with a short summary of what you did and the result (for example: "Created the note X with Y"). Keep any text you write between steps brief; the closing summary is what the person reads first.'

/**
 * The agent's standing instructions plus everything loaded for this turn.
 *
 * Kept separate from the transcript: the room history is `messages`, so the
 * model can tell what it said from what it was told.
 */
export function buildAgentSystemPrompt(args: {
  agentName: string
  agentRole?: Parameters<typeof chiefOrchestrationInstructions>[0]
  contextBlock: string
  exposedToolIds: readonly string[]
  hasTools: boolean
  instructions: string
  isDefaultMaster: boolean
  memoryEnabled?: boolean
}): string {
  // Only promise recall when recall is actually on the table. Telling an agent
  // to search a memory it cannot reach is how it ends up narrating tool calls
  // that never happened.
  const canRecall = args.exposedToolIds.includes('search_memory')
  return [
    `You are ${args.agentName}, a named AI teammate in an Overlay workspace.`,
    args.instructions,
    chiefOrchestrationInstructions(args.agentRole),
    args.isDefaultMaster
      ? 'You are the default Overlay workspace agent. Use only the context, files, skills and tools authorized for this run and its audience.'
      : 'Respond as this agent, not as a generic assistant.',
    args.hasTools
      ? [
          'Use your available tools when they genuinely help, and prefer checking over guessing.',
          `The exact tool names available in this turn are: ${JSON.stringify(args.exposedToolIds)}. Use only these names and their declared input schemas, never invented aliases.`,
          canRecall && args.memoryEnabled !== false
            ? 'Before answering a question about the user, the workspace, or past work, call search_memory rather than assuming you know nothing.' +
              (args.exposedToolIds.includes('search_messages')
                ? ' When you need exact wording, a date, or who said something, call search_messages for the verbatim record.'
                : '')
            : '',
          'Never claim to have used a tool or changed a resource unless the tool call actually ran and returned success. If a requested action has no available tool, say that plainly and offer the result as a draft instead.',
        ].filter(Boolean).join(' ')
      : 'You have no tools or resource access in this turn. Never claim that you used or changed a resource, created or saved a note, sent a message, edited a document, or completed any other external action. Say the capability is unavailable and provide a draft when useful.',
    'Be concise, useful, and explicit when context is insufficient.',
    args.hasTools ? AGENT_CLOSING_SUMMARY_INSTRUCTION : '',
    computerCapabilityNote(new Set(args.exposedToolIds)),
    generatedUiNote(new Set(args.exposedToolIds)),
    knowledgeNote({ constants: SHARED_AGENT_BEHAVIOR_CONSTANTS, memoryEnabled: args.memoryEnabled }, new Set(args.exposedToolIds)),
    args.contextBlock,
    agentFormattingNote(SHARED_AGENT_BEHAVIOR_CONSTANTS),
  ].filter((section) => section && section.trim()).join('\n')
}
