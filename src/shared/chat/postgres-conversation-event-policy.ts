const LOCAL_STREAM_LIFECYCLE_EVENTS = new Set([
  'message.created',
  'message.delta',
  'message.completed',
])

const MESSAGE_EVENTS_REQUIRING_RELOAD = new Set([
  ...LOCAL_STREAM_LIFECYCLE_EVENTS,
  'message.deleted',
  'message.failed',
  'message.stopped',
  'message.ui-updated',
])

export const LOCAL_STREAM_RECONCILIATION_GRACE_MS = 5_000
export const MAX_CONVERSATION_EVENT_RETRY_MS = 30_000

export function conversationEventRetryDelayMs(args: {
  attempt: number
  retryAfterSeconds?: number
}): number {
  if (Number.isFinite(args.retryAfterSeconds) && (args.retryAfterSeconds ?? 0) > 0) {
    return Math.min(
      MAX_CONVERSATION_EVENT_RETRY_MS,
      Math.max(1_000, Math.ceil(args.retryAfterSeconds! * 1_000)),
    )
  }
  return Math.min(
    MAX_CONVERSATION_EVENT_RETRY_MS,
    1_000 * 2 ** Math.min(Math.max(0, Math.floor(args.attempt) - 1), 5),
  )
}

export function shouldReloadActiveConversation(args: {
  eventTypes: readonly string[]
  localStreamGraceUntil: number
  now: number
}): boolean {
  const relevantEvents = args.eventTypes.filter((eventType) => MESSAGE_EVENTS_REQUIRING_RELOAD.has(eventType))
  if (relevantEvents.length === 0) return false
  const onlyLocalLifecycleEvents = relevantEvents.every((eventType) => LOCAL_STREAM_LIFECYCLE_EVENTS.has(eventType))
  return !(onlyLocalLifecycleEvents && args.now < args.localStreamGraceUntil)
}
