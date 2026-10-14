import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 640px)'

function subscribe(listener: () => void) {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

/** True on a phone-sized screen. The server and the first client render say false, so hydration always matches. */
export function useCompactViewport(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
