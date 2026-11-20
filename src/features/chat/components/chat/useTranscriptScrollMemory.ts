'use client'

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { transcriptCache } from '@/components/providers/transcript-cache-client'

const RESTORE_SETTLE_FRAMES = 45
const RESTORE_CANCEL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

function exchangeAnchor(viewport: HTMLElement) {
  const top = viewport.getBoundingClientRect().top
  for (const element of viewport.querySelectorAll<HTMLElement>('[data-exchange-turn]')) {
    const rect = element.getBoundingClientRect()
    if (rect.bottom > top && element.dataset.exchangeTurn) return { anchorId: element.dataset.exchangeTurn, offset: rect.top - top }
  }
  return null
}

/**
 * Remembers where the reader was in each personal conversation and, on a
 * revisit, returns them to that exchange once it is rendered. A reader who was
 * following the newest message keeps the scroller's default end position.
 */
export function useTranscriptScrollMemory(
  viewportRef: RefObject<HTMLDivElement | null>,
  scrollKey: string | null,
  viewportKey: number,
  rowCount: number,
) {
  const restoredKeyRef = useRef<string | null>(null)
  const stopRestoreRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopRestoreRef.current?.(), [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !scrollKey || restoredKeyRef.current === scrollKey || rowCount === 0) return
    restoredKeyRef.current = scrollKey
    stopRestoreRef.current?.()
    stopRestoreRef.current = null
    const snapshot = transcriptCache.scroll(scrollKey)
    if (!snapshot || snapshot.atBottom || !snapshot.anchorId) return
    const anchorId = snapshot.anchorId
    const align = () => {
      const element = Array.from(viewport.querySelectorAll<HTMLElement>('[data-exchange-turn]'))
        .find((candidate) => candidate.dataset.exchangeTurn === anchorId)
      if (!element) return
      viewport.scrollTop += element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - snapshot.offset
    }
    // The scroller settles its default end position and rows change height for a few frames
    // after layout; keep the anchor in place until then unless the reader takes over.
    let frame = 0
    let frames = 0
    const stop = () => {
      window.cancelAnimationFrame(frame)
      for (const type of RESTORE_CANCEL_EVENTS) viewport.removeEventListener(type, stop, { capture: true })
    }
    const settle = () => {
      align()
      frames += 1
      frame = frames < RESTORE_SETTLE_FRAMES ? window.requestAnimationFrame(settle) : 0
    }
    for (const type of RESTORE_CANCEL_EVENTS) viewport.addEventListener(type, stop, { capture: true, passive: true })
    stopRestoreRef.current = stop
    settle()
  }, [rowCount, scrollKey, viewportKey, viewportRef])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !scrollKey) return
    let frame: number | null = null
    const save = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 96
        const anchor = atBottom ? null : exchangeAnchor(viewport)
        transcriptCache.saveScroll(scrollKey, {
          atBottom: atBottom || !anchor, anchorId: anchor?.anchorId ?? null, offset: anchor?.offset ?? 0,
        })
      })
    }
    viewport.addEventListener('scroll', save, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', save)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [scrollKey, viewportKey, viewportRef])
}
