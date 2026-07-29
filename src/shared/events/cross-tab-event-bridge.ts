export interface CrossTabEventEnvelope {
  detail?: unknown
  eventType: string
  messageId: string
  sourceId: string
}

export interface CrossTabEventTransport {
  publish(message: CrossTabEventEnvelope): void
  subscribe(listener: (message: unknown) => void): () => void
}

export interface CrossTabEventBridge {
  dispose(): void
}

const REMOTE_CROSS_TAB_EVENT = Symbol('overlay.remote-cross-tab-event')

type ForwardedEvent = Event & {
  [REMOTE_CROSS_TAB_EVENT]?: boolean
  detail?: unknown
}

function isEnvelope(value: unknown): value is CrossTabEventEnvelope {
  if (!value || typeof value !== 'object') return false
  const envelope = value as Partial<CrossTabEventEnvelope>
  return typeof envelope.eventType === 'string'
    && envelope.eventType.length > 0
    && typeof envelope.messageId === 'string'
    && envelope.messageId.length > 0
    && typeof envelope.sourceId === 'string'
    && envelope.sourceId.length > 0
}

/**
 * Mirrors compact app mutation events across same-origin browser tabs.
 * Remote events are marked before dispatch so they cannot be echoed back.
 */
export function createCrossTabEventBridge(args: {
  createId?: () => string
  eventTarget: EventTarget
  eventTypes: readonly string[]
  sourceId: string
  transport: CrossTabEventTransport
}): CrossTabEventBridge {
  const eventTypes = new Set(args.eventTypes)
  const seen = new Set<string>()
  const createId = args.createId ?? (() => globalThis.crypto.randomUUID())

  function remember(messageId: string): boolean {
    if (seen.has(messageId)) return false
    seen.add(messageId)
    if (seen.size > 256) seen.delete(seen.values().next().value!)
    return true
  }

  const localListeners = new Map<string, EventListener>()
  for (const eventType of eventTypes) {
    const listener: EventListener = (event) => {
      const forwarded = event as ForwardedEvent
      if (forwarded[REMOTE_CROSS_TAB_EVENT]) return
      const message: CrossTabEventEnvelope = {
        detail: forwarded.detail,
        eventType,
        messageId: createId(),
        sourceId: args.sourceId,
      }
      remember(message.messageId)
      args.transport.publish(message)
    }
    localListeners.set(eventType, listener)
    args.eventTarget.addEventListener(eventType, listener)
  }

  const unsubscribe = args.transport.subscribe((message) => {
    if (!isEnvelope(message)
      || message.sourceId === args.sourceId
      || !eventTypes.has(message.eventType)
      || !remember(message.messageId)) return
    const event = new CustomEvent(message.eventType, { detail: message.detail }) as ForwardedEvent
    event[REMOTE_CROSS_TAB_EVENT] = true
    args.eventTarget.dispatchEvent(event)
  })

  return {
    dispose() {
      unsubscribe()
      for (const [eventType, listener] of localListeners) {
        args.eventTarget.removeEventListener(eventType, listener)
      }
      localListeners.clear()
      seen.clear()
    },
  }
}
