'use client'

import { useEffect } from 'react'
import {
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  KNOWLEDGE_RECONCILE_EVENT,
  PROJECT_META_UPDATED_EVENT,
  PROJECTS_CHANGED_EVENT,
} from '@overlay/app-core'
import {
  CHAT_CREATED_EVENT,
  CHAT_DELETED_EVENT,
  CHAT_MODIFIED_EVENT,
  CHAT_TITLE_UPDATED_EVENT,
} from '@/shared/chat/chat-title'
import {
  createCrossTabEventBridge,
  type CrossTabEventEnvelope,
} from '@/shared/events/cross-tab-event-bridge'

const APP_EVENT_CHANNEL = 'overlay:app-events:v1'
const FORWARDED_EVENTS = [
  CHAT_CREATED_EVENT,
  CHAT_DELETED_EVENT,
  CHAT_MODIFIED_EVENT,
  CHAT_TITLE_UPDATED_EVENT,
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  KNOWLEDGE_RECONCILE_EVENT,
  PROJECT_META_UPDATED_EVENT,
  PROJECTS_CHANGED_EVENT,
] as const

export function CrossTabAppEventBridge() {
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(APP_EVENT_CHANNEL)
    const bridge = createCrossTabEventBridge({
      eventTarget: window,
      eventTypes: FORWARDED_EVENTS,
      sourceId: globalThis.crypto.randomUUID(),
      transport: {
        publish(message: CrossTabEventEnvelope) {
          channel.postMessage(message)
        },
        subscribe(listener) {
          const onMessage = (event: MessageEvent<unknown>) => listener(event.data)
          channel.addEventListener('message', onMessage)
          return () => channel.removeEventListener('message', onMessage)
        },
      },
    })
    return () => {
      bridge.dispose()
      channel.close()
    }
  }, [])
  return null
}
