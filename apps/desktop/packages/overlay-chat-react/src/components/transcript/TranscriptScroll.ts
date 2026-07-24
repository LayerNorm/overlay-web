import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

export const TRANSCRIPT_NEAR_BOTTOM_PX = 96
export const TRANSCRIPT_SUBMITTED_TOP_INSET_PX = 16

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

/**
 * Blank space needed after the newest exchange so its first row can remain
 * pinned near the top of the viewport while its response grows below it.
 * The spacer shrinks by exactly the amount the exchange grows, keeping the
 * scroll height stable until the response itself fills the viewport.
 */
export function submittedExchangeReservedSpace(
  clientHeight: number,
  exchangeHeight: number,
  topInset = TRANSCRIPT_SUBMITTED_TOP_INSET_PX,
): number {
  return Math.max(0, clientHeight - topInset - exchangeHeight)
}

/**
 * Absolute scroll position that places a submitted exchange at the shared top
 * inset. This is calculated only when the turn is submitted; response growth
 * is intentionally absent from the inputs so streaming cannot pull the view.
 */
export function submittedExchangeScrollTop({
  containerTop,
  exchangeTop,
  currentScrollTop,
  topInset = TRANSCRIPT_SUBMITTED_TOP_INSET_PX,
}: {
  containerTop: number
  exchangeTop: number
  currentScrollTop: number
  topInset?: number
}): number {
  return Math.max(0, exchangeTop - containerTop + currentScrollTop - topInset)
}

function latestTranscriptExchange(container: HTMLElement): HTMLElement | null {
  const exchanges = container.querySelectorAll<HTMLElement>('[data-exchange-turn]')
  return exchanges.item(exchanges.length - 1)
}

export interface UseTranscriptScrollOptions {
  containerRef: RefObject<HTMLElement | null>
  endRef: RefObject<HTMLElement | null>
  /** Increments when a user submits a new turn. */
  submittedTurnCount: number
  active: boolean
  reserveTailSpace?: boolean
  /** Stable conversation identity used to discard a pin when switching chats. */
  transcriptKey?: string | null
}

/**
 * Shared web/desktop transcript positioning. A submitted turn is aligned once
 * near the top of the viewport. Streaming growth never changes scrollTop: the
 * response grows downward until the user deliberately scrolls.
 */
export function useTranscriptScroll({
  containerRef,
  submittedTurnCount,
  transcriptKey,
}: UseTranscriptScrollOptions): { reservedSpace: number | null } {
  const previousSubmittedTurnCountRef = useRef(submittedTurnCount)
  const previousTranscriptKeyRef = useRef(transcriptKey)
  const pinnedTurnIdRef = useRef<string | null>(null)
  const [reservedSpace, setReservedSpace] = useState<number | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    let reserveFrame = 0
    let scrollFrame = 0
    const latestExchange = latestTranscriptExchange(container)
    const latestTurnId = latestExchange?.getAttribute('data-exchange-turn') ?? null
    const transcriptChanged = previousTranscriptKeyRef.current !== transcriptKey
    const samePinnedExchange = Boolean(
      pinnedTurnIdRef.current && latestTurnId === pinnedTurnIdRef.current,
    )

    previousTranscriptKeyRef.current = transcriptKey
    if (transcriptChanged && !samePinnedExchange) {
      previousSubmittedTurnCountRef.current = submittedTurnCount
      pinnedTurnIdRef.current = null
      reserveFrame = window.requestAnimationFrame(() => setReservedSpace(null))
      return () => window.cancelAnimationFrame(reserveFrame)
    }

    const previousCount = previousSubmittedTurnCountRef.current
    previousSubmittedTurnCountRef.current = submittedTurnCount
    if (submittedTurnCount < previousCount) {
      pinnedTurnIdRef.current = null
      reserveFrame = window.requestAnimationFrame(() => setReservedSpace(null))
      return () => window.cancelAnimationFrame(reserveFrame)
    }
    if (submittedTurnCount <= previousCount || !latestExchange || !latestTurnId) return

    pinnedTurnIdRef.current = latestTurnId
    reserveFrame = window.requestAnimationFrame(() => {
      const currentContainer = containerRef.current
      if (!currentContainer) return
      const target = latestTranscriptExchange(currentContainer)
      if (!target || target.getAttribute('data-exchange-turn') !== pinnedTurnIdRef.current) return
      setReservedSpace(
        submittedExchangeReservedSpace(currentContainer.clientHeight, target.offsetHeight),
      )
      // Let React commit the spacer before scrolling so the browser does not
      // clamp the requested top position to the old, shorter scroll height.
      scrollFrame = window.requestAnimationFrame(() => {
        const latestContainer = containerRef.current
        if (!latestContainer) return
        const latestTarget = latestTranscriptExchange(latestContainer)
        if (!latestTarget || latestTarget.getAttribute('data-exchange-turn') !== pinnedTurnIdRef.current) return
        const containerRect = latestContainer.getBoundingClientRect()
        const targetRect = latestTarget.getBoundingClientRect()
        latestContainer.scrollTo({
          top: submittedExchangeScrollTop({
            containerTop: containerRect.top,
            exchangeTop: targetRect.top,
            currentScrollTop: latestContainer.scrollTop,
          }),
          behavior: 'auto',
        })
      })
    })

    return () => {
      window.cancelAnimationFrame(reserveFrame)
      window.cancelAnimationFrame(scrollFrame)
    }
  }, [containerRef, submittedTurnCount, transcriptKey])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !pinnedTurnIdRef.current || typeof ResizeObserver === 'undefined') return
    const exchange = latestTranscriptExchange(container)
    if (!exchange || exchange.getAttribute('data-exchange-turn') !== pinnedTurnIdRef.current) return

    const updateReservedSpace = () => {
      const nextReservedSpace = submittedExchangeReservedSpace(
        container.clientHeight,
        exchange.offsetHeight,
      )
      setReservedSpace((current) => current === nextReservedSpace ? current : nextReservedSpace)
    }
    const observer = new ResizeObserver(updateReservedSpace)
    observer.observe(container)
    observer.observe(exchange)
    return () => {
      observer.disconnect()
    }
  }, [containerRef, submittedTurnCount, transcriptKey])

  return { reservedSpace }
}
