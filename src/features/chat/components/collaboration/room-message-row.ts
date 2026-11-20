'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import type { OptimisticMessage, RoomMessageContext } from '../DirectMessageExperience.hooks'
import type { AgentThreadTurnActions } from './useAgentThreadTurnActions'

const ROOM_MESSAGE_HANDLERS = [
  'saveEdit',
  'deleteMessage',
  'reportMessage',
  'toggleReaction',
  'togglePinned',
  'toggleSaved',
  'openThread',
  'beginQuoteReply',
  'sendMessage',
  'onOpenAttachmentPreview',
  'copyMessagePermalink',
  'stopAgentResponse',
] as const satisfies readonly (keyof RoomMessageContext)[]

type RoomMessageHandlers = Pick<RoomMessageContext, (typeof ROOM_MESSAGE_HANDLERS)[number]>

/**
 * Message rows receive handlers that always call the latest committed room actions, so their identities
 * stay the same while a reply streams and a memoized row can skip re-rendering.
 */
export function useStableRoomMessageContext(ctx: RoomMessageContext): RoomMessageContext {
  const latest = useRef(ctx)
  useLayoutEffect(() => { latest.current = ctx })
  const handlers = useMemo(() => Object.fromEntries(ROOM_MESSAGE_HANDLERS.map((key) => [
    key,
    (...args: unknown[]) => (latest.current[key] as (...values: unknown[]) => unknown)(...args),
  ])) as RoomMessageHandlers, [])
  // Flags are read from this render's turn actions, so a reply that just settled shows enabled retry and delete;
  // a new object whenever they change lets the row comparison see the change. Only the callbacks are forwarded.
  const snapshot = ctx.agentThreadTurns
  const agentThreadTurns = useMemo<AgentThreadTurnActions | null>(() => snapshot ? ({
    actionsFor: (message, onReply) => {
      const current = () => latest.current.agentThreadTurns?.actionsFor(message, onReply)
      const actions = snapshot.actionsFor(message, onReply)
      return {
        retryDisabled: actions.retryDisabled,
        actionsLocked: actions.actionsLocked,
        onReply,
        onDeleteTurn: () => current()?.onDeleteTurn(),
        ...(actions.onRegenerate ? { onRegenerate: () => current()?.onRegenerate?.() } : {}),
        ...(actions.onBranch ? { onBranch: () => current()?.onBranch?.() } : {}),
      }
    },
  }) : null, [snapshot])
  return { ...ctx, ...handlers, agentThreadTurns }
}

export type RoomMessageRowProps = {
  message: OptimisticMessage
  ctx: RoomMessageContext
  inThread?: boolean
  grouped?: boolean
  hideToolbar?: boolean
}

const noop = () => {}

function turnFlags(ctx: RoomMessageContext, message: OptimisticMessage) {
  const actions = ctx.agentThreadTurns?.actionsFor(message, noop)
  return actions
    ? `${actions.retryDisabled}:${actions.actionsLocked}:${Boolean(actions.onRegenerate)}:${Boolean(actions.onBranch)}`
    : null
}

/** Whether a context change can alter this row; anything the row does not read is ignored. */
function sameRowContextValue(key: keyof RoomMessageContext, prev: RoomMessageContext, next: RoomMessageContext,
  message: OptimisticMessage, inThread: boolean): boolean {
  const id = message.id
  switch (key) {
    case 'isReadOnlyMessage': return prev.isReadOnlyMessage?.(id) === next.isReadOnlyMessage?.(id)
    case 'threadTeasers': return inThread || prev.threadTeasers.get(id) === next.threadTeasers.get(id)
    case 'replyCounts': return inThread || prev.replyCounts.get(id) === next.replyCounts.get(id)
    case 'threadRootId': return !inThread
    case 'editingId': return (prev.editingId === id) === (next.editingId === id)
    case 'editingContent': return prev.editingId !== id && next.editingId !== id
    case 'highlightedMessageId': return (prev.highlightedMessageId === id) === (next.highlightedMessageId === id)
    case 'agentThreadTurns': return turnFlags(prev, message) === turnFlags(next, message)
    default: return false
  }
}

export function sameRoomMessageRowProps(prev: RoomMessageRowProps, next: RoomMessageRowProps): boolean {
  if (prev.message !== next.message || prev.inThread !== next.inThread) return false
  if (prev.grouped !== next.grouped || prev.hideToolbar !== next.hideToolbar) return false
  if (prev.ctx === next.ctx) return true
  const keys = new Set([...Object.keys(prev.ctx), ...Object.keys(next.ctx)]) as Set<keyof RoomMessageContext>
  return [...keys].every((key) => prev.ctx[key] === next.ctx[key]
    || sameRowContextValue(key, prev.ctx, next.ctx, next.message, Boolean(next.inThread)))
}
