'use client'

import { useCallback, useState } from 'react'

const FAVORITE_MODELS_KEY = 'overlay:favorite-models'

// Storage can be blocked (Safari private mode); favorites then live only for the session.
function readFavoriteModelIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FAVORITE_MODELS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeFavoriteModelIds(ids: string[]) {
  try {
    window.localStorage.setItem(FAVORITE_MODELS_KEY, JSON.stringify(ids))
  } catch {
    // Blocked storage keeps the in-memory list.
  }
}

export function useFavoriteModelIds() {
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : readFavoriteModelIds(),
  )
  const toggleFavorite = useCallback((modelId: string) => {
    setFavoriteIds((prev) => {
      const next = prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
      writeFavoriteModelIds(next)
      return next
    })
  }, [])
  return { favoriteIds, toggleFavorite }
}
