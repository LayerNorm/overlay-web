'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'

const FAVORITE_MODELS_KEY = 'overlay:favorite-models:v2'
const FAVORITES_CHANGED = 'overlay:favorite-models-changed'
const sessionFavorites = new Map<string, string>()
const emptySnapshot = () => '[]'

function readSnapshot(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '[]'
  } catch {
    return sessionFavorites.get(key) ?? '[]'
  }
}

function parseFavoriteIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(FAVORITES_CHANGED, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(FAVORITES_CHANGED, onChange)
  }
}

export function useFavoriteModelIds(scope?: string | null) {
  const key = `${FAVORITE_MODELS_KEY}:${scope ?? 'anonymous'}`
  const getSnapshot = useCallback(() => readSnapshot(key), [key])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, emptySnapshot)
  const favoriteIds = useMemo(() => parseFavoriteIds(snapshot), [snapshot])
  const toggleFavorite = useCallback((modelId: string) => {
    const current = parseFavoriteIds(readSnapshot(key))
    const next = current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId]
    const serialized = JSON.stringify(next)
    sessionFavorites.set(key, serialized)
    try {
      window.localStorage.setItem(key, serialized)
    } catch {
      // Blocked storage keeps favorites in memory for this account and session.
    }
    window.dispatchEvent(new Event(FAVORITES_CHANGED))
  }, [key])
  return { favoriteIds, toggleFavorite }
}
