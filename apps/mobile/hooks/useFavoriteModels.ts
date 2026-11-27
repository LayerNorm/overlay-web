import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

export function parseFavoriteModels(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]')
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string'))] : []
  } catch { return [] }
}

export function useFavoriteModels(scope: string | undefined) {
  const key = `overlay:favorite-models:v2:${scope ?? 'anonymous'}`
  const [state, setState] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] })
  const current = useRef(state)
  const scopeKey = useRef(key)
  const writes = useRef(Promise.resolve())
  useEffect(() => {
    scopeKey.current = key
    let active = true
    void AsyncStorage.getItem(key).then(value => {
      if (!active || current.current.key === key) return
      const next = { key, ids: parseFavoriteModels(value) }
      current.current = next
      setState(next)
    }).catch(() => {})
    return () => { active = false; scopeKey.current = '' }
  }, [key])
  const toggle = useCallback((id: string) => {
    writes.current = writes.current.catch(() => {}).then(async () => {
      const old = current.current.key === key ? current.current.ids : parseFavoriteModels(await AsyncStorage.getItem(key))
      const next = { key, ids: old.includes(id) ? old.filter(value => value !== id) : [...old, id] }
      if (scopeKey.current === key) { current.current = next; setState(next) }
      await AsyncStorage.setItem(key, JSON.stringify(next.ids))
    }).catch(() => {})
  }, [key])
  return { favoriteIds: state.key === key ? state.ids : [], toggleFavorite: toggle }
}
