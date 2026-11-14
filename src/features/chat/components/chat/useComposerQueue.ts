'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MentionItem } from '@/shared/knowledge/mention-types'
import {
  readQueuedMessages,
  writeQueuedMessages,
  type QueuedMessage,
  type QueueScope,
} from '@/shared/chat/conversation-queue'
import type { ChatComposerQueueControls } from '../ChatComposerQueue'

/** How long a sent message may take to show up as a running response before the next one is sent. */
export const QUEUE_RUN_START_GRACE_MS = 2_000

export type ComposerQueue = {
  items: QueuedMessage[]
  paused: boolean
  /** Holds a message until the running response settles. */
  enqueue: (text: string, mentions: MentionItem[]) => void
  /** Interrupts the running response and sends this message next. */
  steer: (text: string, mentions: MentionItem[]) => void
  steerItem: (id: string) => void
  remove: (id: string) => void
  /** Removes a queued message and returns it for editing. */
  take: (id: string) => QueuedMessage | null
  /** Keeps queued messages from sending after a manual stop. */
  pause: () => void
}

type QueueState = { key: string | null; items: QueuedMessage[]; paused: boolean }

function scopeKey(scope: QueueScope | null): string | null {
  return scope ? `${scope.workspaceId ?? 'personal'}:${scope.conversationId}` : null
}

function newQueuedMessage(text: string, mentions: MentionItem[]): QueuedMessage {
  return { id: crypto.randomUUID(), text, mentions }
}

/**
 * Queue and steer for one conversation composer. `running` must stay true from
 * the moment a send is accepted until its response settles; `send` resolves
 * true once the message was accepted. A message that is not accepted returns to
 * the front of the queue and pauses it, so nothing is dropped or retried in a loop.
 */
export function useComposerQueue({
  scope,
  running,
  send,
  stop,
}: {
  scope: QueueScope | null
  running: boolean
  send: (message: QueuedMessage) => Promise<boolean>
  stop: () => void | Promise<void>
}): ComposerQueue {
  const key = scopeKey(scope)
  const [state, setState] = useState<QueueState>(() => ({ key, items: scope ? readQueuedMessages(scope) : [], paused: false }))
  if (state.key !== key) {
    // A new chat gets its id while its first response runs; keep what was queued meanwhile.
    const carried = state.key === null ? state.items : []
    const stored = scope ? readQueuedMessages(scope) : []
    setState({ key, items: [...stored, ...carried], paused: false })
  }

  const scopeRef = useRef(scope)
  const sendRef = useRef(send)
  const stopRef = useRef(stop)
  const runningRef = useRef(running)
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    scopeRef.current = scope
    sendRef.current = send
    stopRef.current = stop
    runningRef.current = running
    stateRef.current = state
  })
  useEffect(() => {
    const current = scopeRef.current
    if (current && scopeKey(current) === state.key) writeQueuedMessages(current, state.items)
  }, [state.key, state.items])

  const [wasRunning, setWasRunning] = useState(running)
  if (wasRunning !== running) {
    setWasRunning(running)
    // Any response that starts while the queue is paused was sent by the person, so resume after it.
    if (running && state.paused) setState(current => ({ ...current, paused: false }))
  }

  const sendingRef = useRef(false)
  const startDeadlineRef = useRef(0)
  const [recheck, setRecheck] = useState(0)
  useEffect(() => {
    if (running) startDeadlineRef.current = 0
  }, [running])

  useEffect(() => {
    if (running || state.paused || sendingRef.current || state.items.length === 0) return
    const wait = startDeadlineRef.current - Date.now()
    if (wait > 0) {
      const timer = window.setTimeout(() => setRecheck(value => value + 1), wait)
      return () => window.clearTimeout(timer)
    }
    const next = state.items[0]
    const drainKey = state.key
    sendingRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the drain reacts to the response settling; the message leaves the tray as it is sent
    setState(current => current.key === drainKey
      ? { ...current, items: current.items.filter(item => item.id !== next.id) }
      : current)
    void sendRef.current(next).catch(() => false).then(accepted => {
      sendingRef.current = false
      if (accepted) {
        if (!runningRef.current) startDeadlineRef.current = Date.now() + QUEUE_RUN_START_GRACE_MS
      } else {
        setState(current => current.key === drainKey
          ? { ...current, paused: true, items: [next, ...current.items.filter(item => item.id !== next.id)] }
          : current)
      }
      setRecheck(value => value + 1)
    })
  }, [running, state.items, state.key, state.paused, recheck])

  const interrupt = useCallback(() => {
    if (runningRef.current) void stopRef.current()
  }, [])

  const enqueue = useCallback((text: string, mentions: MentionItem[]) => {
    setState(current => ({ ...current, paused: false, items: [...current.items, newQueuedMessage(text, mentions)] }))
  }, [])

  const steer = useCallback((text: string, mentions: MentionItem[]) => {
    setState(current => ({ ...current, paused: false, items: [newQueuedMessage(text, mentions), ...current.items] }))
    interrupt()
  }, [interrupt])

  const steerItem = useCallback((id: string) => {
    setState(current => {
      const item = current.items.find(candidate => candidate.id === id)
      if (!item) return current
      return { ...current, paused: false, items: [item, ...current.items.filter(candidate => candidate.id !== id)] }
    })
    interrupt()
  }, [interrupt])

  const remove = useCallback((id: string) => {
    setState(current => ({ ...current, items: current.items.filter(item => item.id !== id) }))
  }, [])

  const take = useCallback((id: string) => {
    const item = stateRef.current.items.find(candidate => candidate.id === id) ?? null
    if (item) setState(current => ({ ...current, items: current.items.filter(candidate => candidate.id !== id) }))
    return item
  }, [])

  const pause = useCallback(() => {
    setState(current => current.items.length > 0 ? { ...current, paused: true } : current)
  }, [])

  return { items: state.items, paused: state.paused, enqueue, steer, steerItem, remove, take, pause }
}

export type QueueDraft = { text: string; mentions: MentionItem[] }

/**
 * Connects a composer's draft to its queue. `blockedReason` explains why the
 * current draft cannot wait in the queue, such as attachments that only the
 * live composer can send.
 */
export function useComposerQueueControls({
  queue,
  running,
  readDraft,
  clearDraft,
  loadDraft,
  blockedReason,
  notify,
}: {
  queue: ComposerQueue
  running: boolean
  readDraft: () => QueueDraft
  clearDraft: () => void
  loadDraft: (draft: QueueDraft) => void
  blockedReason: () => string | null
  notify: (message: string) => void
}): ChatComposerQueueControls {
  const takeDraft = (): QueueDraft | null => {
    const draft = readDraft()
    const text = draft.text.trim()
    if (!text) return null
    const reason = blockedReason()
    if (reason) {
      notify(reason)
      return null
    }
    clearDraft()
    return { text, mentions: draft.mentions }
  }
  return {
    running,
    items: queue.items,
    paused: queue.paused,
    onQueueDraft: () => {
      const draft = takeDraft()
      if (draft) queue.enqueue(draft.text, draft.mentions)
    },
    onSteerDraft: () => {
      const draft = takeDraft()
      if (draft) queue.steer(draft.text, draft.mentions)
    },
    onSteerItem: queue.steerItem,
    onEditItem: (id) => {
      const item = queue.take(id)
      if (item) loadDraft(item)
    },
    onRemoveItem: queue.remove,
  }
}
