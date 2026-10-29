'use client'

import { useSyncExternalStore } from 'react'
import type { InlineNavItem } from '../types'

/** The current page's subviews (Work's List/Board/Timeline, Files and Extensions categories), shown as header tabs. */
export interface PageSubviews {
  items: ReadonlyArray<InlineNavItem>
  activeId: string
  pendingId?: string | null
  onSelect: (id: string) => void
}

let current: PageSubviews | null = null
const listeners = new Set<() => void>()

export function publishPageSubviews(next: PageSubviews | null): void {
  current = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePageSubviews(): PageSubviews | null {
  return useSyncExternalStore(subscribe, () => current, () => null)
}
