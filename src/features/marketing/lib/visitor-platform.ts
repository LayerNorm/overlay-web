'use client'

import { useSyncExternalStore } from 'react'

export type VisitorPlatform = 'mac' | 'other'

/** A Mac, as far as the browser says. An iPad reports itself as a Mac but has a touch screen. */
export function detectVisitorPlatform(nav: Pick<Navigator, 'platform' | 'userAgent' | 'maxTouchPoints'>): VisitorPlatform {
  const mac = /Mac/i.test(nav.platform || '') || /Macintosh/i.test(nav.userAgent || '')
  return mac && (nav.maxTouchPoints ?? 0) <= 1 ? 'mac' : 'other'
}

const subscribe = () => () => {}
const read = (): VisitorPlatform => detectVisitorPlatform(navigator)

/**
 * The visitor's computer, for offering the Mac download where it works. Null on
 * the server and until the page hydrates, because marketing pages are static.
 */
export function useVisitorPlatform(): VisitorPlatform | null {
  return useSyncExternalStore<VisitorPlatform | null>(subscribe, read, () => null)
}
