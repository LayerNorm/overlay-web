'use client'

import { useRef } from 'react'
import { useMutation } from 'convex/react'
import type { useRouter } from 'next/navigation'
import { toast } from '@overlay/ui/primitives'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { agentConversationRedirect } from '@/shared/chat/chat-view-navigation'
import { dispatchChatCreated } from '@/shared/chat/chat-title'
import type { RoomMessageRecord } from './room-message-view'
import type { RoomChatActions } from './RoomMessageItem'

type SendMessage = (content: string, options?: { parts?: RoomMessageRecord['parts'] }) => Promise<{ accepted: boolean }>

export type AgentThreadTurnActions = {
  actionsFor: (message: RoomMessageRecord, onReply: () => void) => RoomChatActions
}

/** The person's message an agent reply answers: agent turn ids are `agent_<messageId>_<agentId>`. */
export function agentReplyTriggerId(turnId: string | undefined, agentId: string): string | null {
  const prefix = 'agent_'
  const suffix = `_${agentId}`
  if (!turnId?.startsWith(prefix) || !turnId.endsWith(suffix)) return null
  return turnId.slice(prefix.length, -suffix.length) || null
}

function turnErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('TURN_IN_PROGRESS')) return 'Wait for the reply to finish first.'
  if (message.includes('BRANCH_TOO_LONG')) return 'This thread is too long to branch.'
  return fallback
}

/**
 * Chat-style turn actions for a person's own agent thread: delete removes the
 * whole exchange, retry deletes it and sends the same request again, and branch
 * copies the thread up to a reply into a new thread with the same agent.
 */
export function useAgentThreadTurnActions({
  workspaceId,
  agentId,
  conversationId,
  mainMessages,
  sendMessage,
  router,
}: {
  workspaceId: string | null | undefined
  agentId: string | null | undefined
  conversationId: string
  mainMessages: RoomMessageRecord[]
  sendMessage: SendMessage
  router: ReturnType<typeof useRouter>
}): AgentThreadTurnActions | null {
  const deleteTurnMutation = useMutation(api.agents.threads.deleteTurn)
  const branchMutation = useMutation(api.agents.threads.branch)
  const busyRef = useRef(false)
  if (!workspaceId || !agentId) return null

  const ids = {
    workspaceId,
    agentId,
    conversationId: conversationId as Id<'conversations'>,
  }
  const live = mainMessages.filter((message) => !message.deletedAt && !message.id.startsWith('optimistic_'))
  const latestReplyId = live.findLast((message) => message.authorKind === 'agent')?.id ?? null
  const running = mainMessages.some((message) => message.status === 'generating' || message.delivery === 'sending')

  async function exclusive(task: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    try {
      await task()
    } finally {
      busyRef.current = false
    }
  }

  const deleteTurn = (message: RoomMessageRecord) => exclusive(async () => {
    try {
      await deleteTurnMutation({ ...ids, messageId: message.id as Id<'conversationMessages'> })
    } catch (error) {
      toast.error(turnErrorMessage(error, 'Could not delete this turn.'))
    }
  })

  const retryTurn = (reply: RoomMessageRecord) => exclusive(async () => {
    const triggerId = agentReplyTriggerId(reply.turnId, agentId)
    const trigger = live.find((message) => message.id === triggerId && message.authorKind === 'human')
    if (!trigger) {
      toast.error('Could not find the request to retry.')
      return
    }
    try {
      await deleteTurnMutation({ ...ids, messageId: trigger.id as Id<'conversationMessages'> })
    } catch (error) {
      toast.error(turnErrorMessage(error, 'Could not retry this response.'))
      return
    }
    await sendMessage(trigger.content, trigger.parts?.length ? { parts: trigger.parts } : undefined)
  })

  const branchFrom = (message: RoomMessageRecord) => exclusive(async () => {
    try {
      const branch = await branchMutation({ ...ids, messageId: message.id as Id<'conversationMessages'> })
      dispatchChatCreated({ chat: {
        _id: branch.conversationId, title: branch.title, lastModified: Date.now(), conversationType: 'dm',
      } })
      const href = agentConversationRedirect({
        pathname: window.location.pathname,
        workspaceId,
        agentId,
        conversationId: branch.conversationId,
        guided: false,
      })
      const target = new URL(href ?? window.location.href, window.location.origin)
      target.searchParams.set('id', branch.conversationId)
      for (const key of ['message', 'draft', 'handoff']) target.searchParams.delete(key)
      router.push(`${target.pathname}?${target.searchParams.toString()}`)
      toast.success('Branch created.')
    } catch (error) {
      toast.error(turnErrorMessage(error, 'Could not create branch.'))
    }
  })

  return {
    actionsFor: (message, onReply) => ({
      onRegenerate: () => void retryTurn(message),
      retryDisabled: running || message.id !== latestReplyId,
      actionsLocked: running && message.id === latestReplyId,
      onDeleteTurn: () => void deleteTurn(message),
      onReply,
      onBranch: () => void branchFrom(message),
    }),
  }
}
