import 'server-only'

import type { ModelMessage } from 'ai'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import {
  buildMemoryContext,
  buildSkillDirectoryContext,
} from '@/server/conversations/ActContextService'

/** How many room messages the agent reads back. */
const AGENT_HISTORY_MESSAGE_LIMIT = 24
/** Roster lines are cheap, but a large channel should not crowd out the transcript. */
const AGENT_ROSTER_LIMIT = 40

export type AgentRoomMessage = {
  _id: string
  authorKind?: 'human' | 'agent' | 'model' | 'system'
  authorPrincipalId?: string
  content: string
  deletedAt?: number
}

export type AgentRoomParticipant = {
  displayName?: string
  principalId: string
  principalType: 'human' | 'agent'
}

export type AgentTurnContext = {
  /** Retrieval, memory, and skills, ready to append to the system prompt. */
  contextBlock: string
  /** The room transcript as role-tagged messages. */
  messages: ModelMessage[]
  /** Whether any memory was actually recalled, for logging. */
  recalledMemory: boolean
}

/**
 * Loads everything an agent needs to know before it answers.
 *
 * Room agents used to run on a flattened `"Name: text"` string with no memory,
 * no retrieval, and no skills — which is why an agent granted "Persistent
 * memory" could still truthfully say it knew nothing about the user. This
 * builds the same context personal chat gets (`ActContextService.loadTurnContext`)
 * plus the room-native context personal chat has no need for: who is in the
 * room, and which of them is the agent itself.
 *
 * Every source is individually fallible and individually caught: a retrieval
 * outage should cost the agent some context, not the whole turn.
 */
export async function buildAgentTurnContext(args: {
  accessToken?: string
  actorUserId: string
  agentName: string
  agentPrincipalId: string
  billingProgrammaticSubjectId?: string
  conversationTitle?: string
  conversationType: 'personal' | 'dm' | 'channel'
  history: readonly AgentRoomMessage[]
  idempotencyKey: string
  latestUserText: string
  memoryEnabled: boolean
  participants: readonly AgentRoomParticipant[]
  projectId?: string
  requestFingerprint: string
  workspaceId: string
}): Promise<AgentTurnContext> {
  const server = getOverlayServerContext()

  const memoriesTask: Promise<string> = args.memoryEnabled
    ? (async () => {
        try {
          const memories = await server.appData.repositories.conversations.listMemories({
            userId: args.actorUserId,
            workspaceId: args.workspaceId,
          })
          return buildMemoryContext(memories ?? [])
        } catch (error) {
          logger.warn('[workspace-agent] memory load failed', { error })
          return ''
        }
      })()
    : Promise.resolve('')

  const retrievalTask: Promise<string> = (async () => {
    if (!args.latestUserText.trim()) return ''
    try {
      const { buildAutoRetrievalBundle } = await import('@/server/knowledge/ask-knowledge-context')
      const bundle = await buildAutoRetrievalBundle({
        accessToken: args.accessToken,
        billing: {
          actorUserId: args.actorUserId,
          idempotencyKey: args.idempotencyKey,
          operationId: 'workspace.agent.auto-retrieval',
          ...(args.billingProgrammaticSubjectId
            ? { programmaticSubjectId: args.billingProgrammaticSubjectId }
            : {}),
          requestFingerprint: args.requestFingerprint,
        },
        includeMemories: args.memoryEnabled,
        projectId: args.projectId,
        userId: args.actorUserId,
        userMessage: args.latestUserText,
        workspaceId: args.workspaceId,
      })
      return bundle.extension
    } catch (error) {
      logger.warn('[workspace-agent] auto-retrieval failed', { error })
      return ''
    }
  })()

  const skillsTask: Promise<string> = (async () => {
    try {
      const directory = await server.appData.repositories.conversations.listSkillDirectory({
        userId: args.actorUserId,
      })
      return buildSkillDirectoryContext(
        (directory ?? [])
          .filter((skill) => skill.enabled !== false)
          .map((skill) => ({ name: skill.name, description: skill.description ?? '' })),
      )
    } catch (error) {
      logger.warn('[workspace-agent] skill directory load failed', { error })
      return ''
    }
  })()

  const [memoryContext, retrievalContext, skillsContext] = await Promise.all([
    memoriesTask,
    retrievalTask,
    skillsTask,
  ])

  const contextBlock = [
    buildRoomContext({
      agentName: args.agentName,
      agentPrincipalId: args.agentPrincipalId,
      conversationTitle: args.conversationTitle,
      conversationType: args.conversationType,
      participants: args.participants,
    }),
    memoryContext,
    retrievalContext,
    skillsContext,
  ].filter((section) => section.trim()).join('\n')

  return {
    contextBlock,
    messages: buildAgentMessages({
      agentPrincipalId: args.agentPrincipalId,
      history: args.history,
      participants: args.participants,
    }),
    recalledMemory: Boolean(memoryContext.trim() || retrievalContext.trim()),
  }
}

/**
 * Describes the room the agent is speaking in.
 *
 * Without this an agent in a channel cannot tell who it is talking to, cannot
 * address people by name, and cannot tell its own past messages from another
 * agent's.
 */
export function buildRoomContext(args: {
  agentName: string
  agentPrincipalId: string
  conversationTitle?: string
  conversationType: 'personal' | 'dm' | 'channel'
  participants: readonly AgentRoomParticipant[]
}): string {
  const roster = args.participants
    .slice(0, AGENT_ROSTER_LIMIT)
    .map((participant) => {
      const name = participant.displayName?.trim() || 'Unnamed'
      const self = participant.principalId === args.agentPrincipalId ? ' (you)' : ''
      return `- ${name} — ${participant.principalType}${self}`
    })
  const omitted = Math.max(0, args.participants.length - AGENT_ROSTER_LIMIT)
  if (omitted > 0) roster.push(`- [${omitted} more participants omitted]`)
  const place = args.conversationType === 'channel'
    ? `the #${args.conversationTitle?.trim() || 'channel'} channel`
    : 'a direct message'
  return [
    `\n\nRoom: you are ${args.agentName}, replying in ${place}.`,
    roster.length > 0 ? `Participants:\n${roster.join('\n')}` : '',
  ].filter(Boolean).join('\n')
}

/**
 * Converts room history into role-tagged model messages.
 *
 * The agent's own past messages become `assistant` turns and everyone else's
 * become `user` turns, so the model can tell what it already said. Multiple
 * humans and multiple agents share the `user` role, so each line still carries
 * its author's name — that naming is display context inside the message, not a
 * substitute for the role.
 */
export function buildAgentMessages(args: {
  agentPrincipalId: string
  history: readonly AgentRoomMessage[]
  participants: readonly AgentRoomParticipant[]
}): ModelMessage[] {
  const namesByPrincipalId = new Map(
    args.participants.map((participant) => [participant.principalId, participant.displayName?.trim()]),
  )
  return args.history
    .filter((message) => !message.deletedAt && message.content.trim())
    .slice(-AGENT_HISTORY_MESSAGE_LIMIT)
    .map((message) => {
      const isSelf = message.authorKind === 'agent'
        && message.authorPrincipalId === args.agentPrincipalId
      if (isSelf) return { role: 'assistant' as const, content: message.content }
      const fallback = message.authorKind === 'agent' ? 'Agent' : 'Teammate'
      const author = (message.authorPrincipalId
        ? namesByPrincipalId.get(message.authorPrincipalId)
        : undefined) ?? fallback
      return { role: 'user' as const, content: `${author}: ${message.content}` }
    })
}
