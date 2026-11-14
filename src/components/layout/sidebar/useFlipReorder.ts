'use client'

import { useLayoutEffect, useRef, type RefObject } from 'react'

const DURATION_MS = 260
const EASING = 'cubic-bezier(0.2, 0, 0, 1)'

/**
 * FLIP-animates direct children of `listRef` marked with `data-agent-row`
 * whenever `orderKey` changes, so a row that jumps to the top slides there
 * (with its expanded threads) instead of teleporting. Respects reduced motion.
 */
export function useFlipReorder(listRef: RefObject<HTMLElement | null>, orderKey: string) {
  const positions = useRef(new Map<string, number>())
  const previousKey = useRef(orderKey)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const rows = Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-agent-row]'))
    const next = new Map<string, number>()
    for (const row of rows) next.set(row.dataset.agentRow!, row.getBoundingClientRect().top)

    const reordered = previousKey.current !== orderKey
    previousKey.current = orderKey
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reordered && !reduceMotion) {
      for (const row of rows) {
        const before = positions.current.get(row.dataset.agentRow!)
        const after = next.get(row.dataset.agentRow!)
        if (before === undefined || after === undefined) continue
        const delta = before - after
        if (Math.abs(delta) < 1) continue
        row.animate?.(
          [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
          { duration: DURATION_MS, easing: EASING },
        )
        // The row moving up rides above the rows it passes.
        if (delta > 0) {
          row.style.zIndex = '1'
          window.setTimeout(() => { row.style.zIndex = '' }, DURATION_MS)
        }
      }
    }
    positions.current = next
  })
}
