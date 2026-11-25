/**
 * Production time to first reply text: from send to the first render that shows
 * non-empty assistant text for that turn. The render is a proxy for visibility, not
 * proof the text was painted. This state is separate from the console-only TTFT debug
 * tool in `ttft-client-debug.ts`, and holds only a few recent turns.
 */

import { BYOK_MODEL_PREFIX, parseByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { INTERRUPTED_RESPONSE_NOTICE } from './agent-assistant-text'

export const FIRST_REPLY_EVENT = 'chat_first_text_visible'

export type FirstReplyTransport = 'convex' | 'sse'

export type FirstReplyProperties = {
  ttft_ms: number
  model_id: string
  is_new_chat: boolean
  was_hidden: boolean
  transport: FirstReplyTransport
}

export type FirstReplyStart = {
  startedAt: number
  modelId: string
  isNewChat: boolean
  /** Sent through Convex-native chat; otherwise the reply streams over the act response. */
  native: boolean
  /** The conversation the turn was sent in, or null while a new chat is still being saved. */
  conversationId: string | null
  hidden: boolean
}

type PendingReply = FirstReplyStart & { startedInNewChat: boolean; settledAt: number | null }

type ReplyMessage = {
  id: string
  role: string
  turnId?: string
  status?: string
  parts?: ReadonlyArray<{ type: string; text?: unknown }>
  metadata?: unknown
}

export type FirstReplyView = {
  /** The Convex-native transcript as rendered. */
  native: readonly ReplyMessage[]
  /** The act response's AI SDK messages. */
  sdk: readonly ReplyMessage[]
}

export type FirstReplyProgress = { transport: FirstReplyTransport } | 'ended' | 'waiting'

const MAX_PENDING = 8
const MAX_REPORTED = 64
/** How long a settled turn may still wait for its reply, which can reach the transcript after the run ends. */
export const SETTLED_REPLY_GRACE_MS = 5_000

/**
 * Only the model's own text counts. An error reply (a failed run, or the client's
 * could-not-save and could-not-receive notes) and the notice a cancelled run adds do not.
 */
function showsReplyText(message: ReplyMessage): boolean {
  if (message.status === 'error') return false
  return message.parts?.some((part) => {
    if (part.type !== 'text' || typeof part.text !== 'string') return false
    const text = part.text.trim()
    return text.length > 0 && text !== INTERRUPTED_RESPONSE_NOTICE
  }) ?? false
}

/** A bring-your-own-key model ID names the user's own connection; report only the model behind it. */
export function telemetryModelId(modelId: string): string {
  if (!modelId.startsWith(BYOK_MODEL_PREFIX)) return modelId
  const byok = parseByokModelId(modelId)
  return byok ? `${BYOK_MODEL_PREFIX}${byok.rawModelId}` : 'byok'
}

function readsLiveReplyFromConvex(message: ReplyMessage): boolean {
  const accepted = (message.metadata as { harnessAccepted?: { liveTransport?: unknown } } | undefined)?.harnessAccepted
  return accepted?.liveTransport === 'convex'
}

/** Assistant messages after the turn's own user message, which carries the turn id as its id. */
function sdkRepliesForTurn(messages: readonly ReplyMessage[], turnId: string): ReplyMessage[] {
  const userIndex = messages.findIndex(message => message.role === 'user' && message.id === turnId)
  if (userIndex < 0) return []
  const replies: ReplyMessage[] = []
  for (const message of messages.slice(userIndex + 1)) {
    if (message.role === 'user') break
    if (message.role === 'assistant') replies.push(message)
  }
  return replies
}

/** Whether one turn's reply shows text yet, and over which transport it arrived. */
export function firstReplyProgress(
  turnId: string,
  turn: Pick<PendingReply, 'native' | 'settledAt'>,
  view: FirstReplyView,
  now: number,
): FirstReplyProgress {
  const relayed = sdkRepliesForTurn(view.sdk, turnId)
    .some(message => showsReplyText(message) && !readsLiveReplyFromConvex(message))
  const replies = turn.native
    ? view.native.filter(message => message.role === 'assistant' && message.turnId === turnId)
    : []
  if (relayed) return { transport: 'sse' }
  if (replies.some(showsReplyText)) return { transport: 'convex' }
  if (replies.length > 0 && replies.every(reply => reply.status === 'completed' || reply.status === 'error')) {
    return 'ended'
  }
  const graceOver = turn.settledAt !== null && now - turn.settledAt >= SETTLED_REPLY_GRACE_MS
  return graceOver && !replies.some(reply => reply.status === 'generating') ? 'ended' : 'waiting'
}

/**
 * A turn stops being measured when its conversation leaves the screen. A new chat's
 * view can briefly show no conversation, or the pending first chat, before its saved id.
 */
function stillShown(turn: PendingReply, shownConversationId: string | null): boolean {
  if (turn.conversationId === null) return true
  if (shownConversationId === null) return turn.startedInNewChat
  return shownConversationId === turn.conversationId
}

export function createFirstReplyTracker() {
  const pending = new Map<string, PendingReply>()
  const reported = new Set<string>()

  function report(turnId: string) {
    reported.add(turnId)
    if (reported.size > MAX_REPORTED) reported.delete(reported.values().next().value!)
  }

  return {
    begin(turnId: string, start: FirstReplyStart) {
      if (reported.has(turnId)) return
      pending.delete(turnId)
      pending.set(turnId, { ...start, startedInNewChat: start.conversationId === null, settledAt: null })
      if (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value!)
    },
    /** A new chat's turn now belongs to its saved conversation. */
    persisted(turnId: string, conversationId: string) {
      const turn = pending.get(turnId)
      if (turn) turn.conversationId = conversationId
    },
    /** The send finished, failed or was cancelled; a reply with no text after the grace period never reports. */
    settle(turnId: string, now: number) {
      const turn = pending.get(turnId)
      if (turn && turn.settledAt === null) turn.settledAt = now
    },
    markHidden() {
      for (const turn of pending.values()) turn.hidden = true
    },
    pendingCount: () => pending.size,
    /** Reports each turn whose first text is now shown, once, and forgets turns that ended or left the screen. */
    observe(shownConversationId: string | null, view: FirstReplyView, now: number): FirstReplyProperties[] {
      const ready: FirstReplyProperties[] = []
      for (const [turnId, turn] of pending) {
        if (!stillShown(turn, shownConversationId)) {
          pending.delete(turnId)
          continue
        }
        const progress = firstReplyProgress(turnId, turn, view, now)
        if (progress === 'waiting') continue
        pending.delete(turnId)
        if (progress === 'ended') continue
        report(turnId)
        ready.push({
          ttft_ms: Math.max(0, Math.round(now - turn.startedAt)),
          model_id: telemetryModelId(turn.modelId),
          is_new_chat: turn.isNewChat,
          was_hidden: turn.hidden,
          transport: progress.transport,
        })
      }
      return ready
    },
  }
}

export type FirstReplyTracker = ReturnType<typeof createFirstReplyTracker>

/** The sending tab's turns. Other tabs and other people's replies are never measured. */
export const firstReplyTracker = createFirstReplyTracker()
