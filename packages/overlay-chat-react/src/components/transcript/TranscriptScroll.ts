import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

export const TRANSCRIPT_NEAR_BOTTOM_PX = 96

export function transcriptDistanceFromBottom({
  scrollHeight,
  scrollTop,
  clientHeight,
}: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight)
}

export function isTranscriptNearBottom(
  measurements: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = TRANSCRIPT_NEAR_BOTTOM_PX,
): boolean {
  return transcriptDistanceFromBottom(measurements) <= threshold
}

export function streamingTranscriptTailHeight(clientHeight: number): number {
  return Math.min(240, Math.max(160, clientHeight * 0.2))
}

export function streamingTranscriptReservedSpace(clientHeight: number): number {
  return Math.max(0, clientHeight - streamingTranscriptTailHeight(clientHeight))
}

export interface UseTranscriptScrollOptions {
  containerRef: RefObject<HTMLElement | null>
  endRef: RefObject<HTMLElement | null>
  /** Increments when a user submits a new turn. */
  submittedTurnCount: number
  active: boolean
  reserveTailSpace?: boolean
}

/**
 * Shared web/desktop transcript-following behavior. Content growth follows the
 * tail only while the viewport is already near it. A newly submitted turn is
 * the one intentional exception and always brings the new exchange into view.
 */
export function useTranscriptScroll({
  containerRef,
  endRef,
  submittedTurnCount,
  active,
  reserveTailSpace = active,
}: UseTranscriptScrollOptions): { reservedSpace: number | null } {
  const followTailRef = useRef(true)
  const previousSubmittedTurnCountRef = useRef(submittedTurnCount)
  const [reservedSpace, setReservedSpace] = useState<number | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateFollowIntent = () => {
      followTailRef.current = isTranscriptNearBottom(container)
    }
    container.addEventListener('scroll', updateFollowIntent, { passive: true })
    updateFollowIntent()
    return () => container.removeEventListener('scroll', updateFollowIntent)
  }, [containerRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const content = container.firstElementChild ?? container
    const observer = new ResizeObserver(() => {
      if (reserveTailSpace) {
        const nextReservedSpace = streamingTranscriptReservedSpace(container.clientHeight)
        setReservedSpace((current) => current === nextReservedSpace ? current : nextReservedSpace)
      }
      if (!active || !followTailRef.current) return
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = 0
        endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      })
    })
    observer.observe(container)
    if (content !== container) observer.observe(content)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [active, containerRef, endRef, reserveTailSpace])

  useEffect(() => {
    const previousCount = previousSubmittedTurnCountRef.current
    previousSubmittedTurnCountRef.current = submittedTurnCount
    if (submittedTurnCount <= previousCount) return
    followTailRef.current = true
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [endRef, submittedTurnCount])

  return { reservedSpace: reserveTailSpace ? reservedSpace : null }
}
