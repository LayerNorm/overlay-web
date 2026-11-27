import type { FunctionReturnType } from 'convex/server'
import { api, mutateConvex, subscribeConvex, type Id } from './convexClient'
import { mobileOverlayAppClient } from './overlayClient'
import { getRequestWorkspaceId } from './appApi'
import type { NativeAgentApproval } from '../../src/shared/agents/native-agent-approval'
import type { NativeAgentInput } from '../../src/shared/agents/native-agent-input'
import type { RoomMessageRecord } from '../lib/roomMessages'
import {
  projectActivePublicStreams,
  type ActivePublicStreamSnapshot,
} from '../../src/shared/chat/public-stream-projection'

export type AgentRecord = NonNullable<
  FunctionReturnType<typeof api.agents.directory.get>
>
export type ThreadBundle = FunctionReturnType<typeof api.agents.threads.bundle>
export type ThreadActivity = FunctionReturnType<
  typeof api.agents.threads.activity
>
export type ThreadCompatibility = FunctionReturnType<
  typeof api.collaboration.rooms.compatibility
>
export type AgentComputer = NonNullable<
  FunctionReturnType<typeof api.computers.browse.list>
>[number]
export type AgentFiles = FunctionReturnType<
  typeof api.files.browse.forConversation
>

export function watchAgentFiles(
  workspaceId: string,
  conversationId: string,
  value: (files: AgentFiles) => void,
  error: (reason: unknown) => void,
) {
  return subscribeConvex(
    api.files.browse.forConversation,
    { workspaceId, conversationId },
    value,
    error,
  )
}

export function watchAgentMessages(
  workspaceId: string,
  conversationId: string,
  cursor: string | null,
  value: (messages: RoomMessageRecord[], next: string | null) => void,
  error: (reason: unknown) => void,
) {
  const args = {
    workspaceId,
    conversationId: conversationId as Id<'conversations'>,
  }
  let rows: RoomMessageRecord[] = []
  let streams: ActivePublicStreamSnapshot[] = []
  let next: string | null = null
  let streamKey = ''
  let stopStreams: (() => void) | undefined
  const emit = () => value(projectActivePublicStreams(rows, streams), next)
  const stop = subscribeConvex(
    api.collaboration.rooms.messages,
    { ...args, paginationOpts: { numItems: 50, cursor } },
    (page) => {
      rows = page.page
      next = page.isDone ? null : page.continueCursor
      const messageIds = rows
        .filter((row) => row.status === 'generating')
        .map((row) => row.id as Id<'conversationMessages'>)
      const key = messageIds.join(',')
      if (key !== streamKey) {
        stopStreams?.()
        streams = []
        streamKey = key
        stopStreams = messageIds.length
          ? subscribeConvex(
              api.collaboration.rooms.activePublicStreams,
              { ...args, messageIds },
              (result) => {
                streams = result
                emit()
              },
              error,
            )
          : undefined
      }
      emit()
    },
    error,
  )
  return () => {
    stop()
    stopStreams?.()
  }
}

export function watchAgent(
  workspaceId: string,
  agentId: string,
  value: (agent: AgentRecord | null) => void,
  error: (reason: unknown) => void,
) {
  return subscribeConvex(
    api.agents.directory.get,
    { workspaceId, agentId },
    value,
    error,
  )
}

export function watchAgentThreads(
  workspaceId: string,
  agentId: string,
  bundle: (value: ThreadBundle) => void,
  activity: (value: ThreadActivity) => void,
  error: (reason: unknown) => void,
) {
  const stops: Array<() => void> = []
  try {
    stops.push(
      subscribeConvex(
        api.agents.threads.bundle,
        { workspaceId, agentId },
        bundle,
        error,
      ),
    )
    stops.push(
      subscribeConvex(
        api.agents.threads.activity,
        { workspaceId, agentId },
        activity,
        error,
      ),
    )
  } catch (reason) {
    stops.forEach((stop) => stop())
    throw reason
  }
  return () => stops.forEach((stop) => stop())
}

export function watchThreadCompatibility(
  workspaceId: string,
  conversationId: string,
  value: (result: ThreadCompatibility) => void,
  error: (reason: unknown) => void,
) {
  return subscribeConvex(
    api.collaboration.rooms.compatibility,
    { workspaceId, conversationId: conversationId as Id<'conversations'> },
    value,
    error,
  )
}

export function watchAgentComputers(
  workspaceId: string,
  value: (computers: AgentComputer[] | null) => void,
  error: (reason: unknown) => void,
) {
  return subscribeConvex(
    api.computers.browse.list,
    { workspaceId },
    value,
    error,
  )
}

export function archiveAgentThread(
  workspaceId: string,
  agentId: string,
  conversationId: string,
  archived: boolean,
) {
  return mutateConvex(api.agents.threads.setArchived, {
    workspaceId,
    agentId,
    conversationId: conversationId as Id<'conversations'>,
    archived,
  })
}

export function removeAgentThread(
  workspaceId: string,
  agentId: string,
  conversationId: string,
) {
  return mutateConvex(api.agents.threads.remove, {
    workspaceId,
    agentId,
    conversationId: conversationId as Id<'conversations'>,
  })
}

function currentWorkspace(workspaceId: string) {
  if (getRequestWorkspaceId() !== workspaceId)
    throw new Error('Workspace changed. Reopen this thread.')
  return { headers: { 'x-overlay-workspace-id': workspaceId } }
}

export async function sendAgentMessage(
  workspaceId: string,
  conversationId: string,
  content: string,
  nonce: string,
) {
  if (!content.trim()) throw new Error('Write a message first.')
  const result = await mobileOverlayAppClient.conversations.addMessage(
    {
      conversationId,
      content: content.trim(),
      turnId: nonce,
      clientNonce: nonce,
      role: 'user',
      mode: 'act',
      contentType: 'text',
      mentionedPrincipalIds: [],
      memoryEnabled: true,
    },
    { ...currentWorkspace(workspaceId), idempotencyKey: `agent:${nonce}` },
  )
  if (!result.success) throw new Error('Could not send message.')
}

export async function stopAgentReply(
  workspaceId: string,
  conversationId: string,
  messageId: string,
) {
  const response = await mobileOverlayAppClient.conversations.stopResponse(
    { conversationId, messageId },
    currentWorkspace(workspaceId),
  )
  if (!response.ok)
    throw new Error(
      'Could not confirm that the response stopped. It may still be running.',
    )
}

function requestScope(
  workspaceId: string,
  conversationId: string,
  userId: string,
  request: NativeAgentApproval | NativeAgentInput,
) {
  if (request.conversationId !== conversationId || request.userId !== userId)
    throw new Error('This request belongs to the person who started the run.')
  return currentWorkspace(workspaceId)
}

export async function decideAgentApproval(
  workspaceId: string,
  conversationId: string,
  userId: string,
  request: NativeAgentApproval,
  approved: boolean,
) {
  const result = await mobileOverlayAppClient.conversations.submitRunApproval(
    {
      conversationId,
      agentRunId: request.runId,
      token: request.token,
      approved,
    },
    requestScope(workspaceId, conversationId, userId, request),
  )
  if (!result.success) throw new Error('Could not send decision.')
}

export async function answerAgentQuestion(
  workspaceId: string,
  conversationId: string,
  userId: string,
  request: NativeAgentInput,
  text: string,
) {
  if (!text.trim()) throw new Error('Write an answer first.')
  const result = await mobileOverlayAppClient.conversations.submitRunInput(
    {
      conversationId,
      agentRunId: request.runId,
      token: request.token,
      text: text.trim(),
    },
    requestScope(workspaceId, conversationId, userId, request),
  )
  if (!result.success) throw new Error('Could not send your reply.')
}
