import type { usePersonalChat } from '@/components/providers/PersonalChatProvider'
import type { useNativeRoomLists } from './native-room-lists'
import { useSyncExternalStore } from 'react'

function subscribeArchivedRoute(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  window.addEventListener('overlay:chat-route-selected', onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener('overlay:chat-route-selected', onChange)
  }
}

export function useArchivedSelectedId(searchId: string | null) {
  return useSyncExternalStore(subscribeArchivedRoute,
    () => new URLSearchParams(window.location.search).get('id') ?? searchId, () => searchId)
}

export function nativeArchivedLoading(rooms: ReturnType<typeof useNativeRoomLists>, personal: ReturnType<typeof usePersonalChat>, legacyLoading: boolean, waitingForSummary: boolean) {
  if (!rooms.enabled) return legacyLoading
  return rooms.loading || (personal.configured && personal.archived.status === 'loading')
    || (waitingForSummary && personal.archived.status !== 'unavailable')
}

export function deferArchivedSelection(native: boolean, selectedId: string | null, loading: boolean, waitingForSummary: boolean, count: number) {
  return (native && Boolean(selectedId)) || loading || waitingForSummary || count === 0
}
