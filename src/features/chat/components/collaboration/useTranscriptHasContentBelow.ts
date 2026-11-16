'use client'

import { useLayoutEffect, useState, type RefObject } from 'react'

export function useTranscriptHasContentBelow(
  listRef: RefObject<HTMLDivElement | null>,
  spacerRef: RefObject<HTMLDivElement | null>,
) {
  const [hasContentBelow, setHasContentBelow] = useState(false)

  useLayoutEffect(() => {
    const node = listRef.current
    if (!node) return
    const measure = () => {
      const spacerHeight = spacerRef.current?.offsetHeight ?? 0
      setHasContentBelow(node.scrollHeight - spacerHeight - node.scrollTop - node.clientHeight > 1)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    if (node.firstElementChild) observer.observe(node.firstElementChild)
    node.addEventListener('scroll', measure)
    return () => {
      observer.disconnect()
      node.removeEventListener('scroll', measure)
    }
  })

  return hasContentBelow
}
