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
