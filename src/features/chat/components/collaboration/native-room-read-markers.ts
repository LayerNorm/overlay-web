'use client'

import { useCallback, useEffect, useRef } from 'react'
import { toast } from '@overlay/ui/primitives'
import { useNativeActivity } from '@/components/providers/native-activity-context'
import { useNativeRoomMetadata } from './NativeRoomState'
import { useNativeRoomSession } from './NativeRoomScope'

export function observedRenderedSequence(list: HTMLElement | null) {
  if (!list) return 0
  const viewport = list.getBoundingClientRect()
  let observed = 0
  for (const node of list.querySelectorAll<HTMLElement>('[data-room-event-sequence]')) {
    const rect = node.getBoundingClientRect()
    const sequence = Number(node.dataset.roomEventSequence)
    if (rect.bottom > viewport.top && rect.top < viewport.bottom && rect.height > 0 && Number.isFinite(sequence)) observed = Math.max(observed, sequence)
  }
  return observed
}

export function useNativeReadMarkersSource<T extends { unreadBoundarySequence: number | null; markVisibleRead(): Promise<void> }>(conversationId: string, legacy: T): T {
  const native = useNativeActivity()
  const owner = useNativeRoomMetadata()
  const session = useNativeRoomSession()
  const inFlight = useRef(false)
  const stored = owner?.snapshot?.viewerState.lastReadSequence ?? 0
  const readSequence = native?.readSequence(conversationId, stored) ?? stored
  const markVisibleRead = useCallback(async () => {
    if (!native || !session || document.visibilityState !== 'visible' || inFlight.current) return
    const sequence = observedRenderedSequence(session.transcript.listRef.current)
    if (!sequence || sequence <= readSequence) return
    inFlight.current = true
    try {
      await native.markRoom(conversationId, sequence)
    } catch { toast.error('Conversation could not be marked read') }
    finally { inFlight.current = false }
  }, [conversationId, native, readSequence, session])
  useEffect(() => {
    if (!native || !session) return
    const list = session.transcript.listRef.current
    let frame: number | undefined
    const observe = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { void markVisibleRead() })
    }
    observe()
    list?.addEventListener('scroll', observe, { passive: true })
    document.addEventListener('visibilitychange', observe)
    return () => { list?.removeEventListener('scroll', observe); document.removeEventListener('visibilitychange', observe); if (frame !== undefined) cancelAnimationFrame(frame) }
  }, [markVisibleRead, native, session])
  return native ? { ...legacy, markVisibleRead, unreadBoundarySequence: readSequence } : legacy
}
