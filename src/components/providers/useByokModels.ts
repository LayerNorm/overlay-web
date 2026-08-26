'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { registerByokModels } from '@/shared/ai/gateway/model-data'
import {
  isByokConnectionRow,
  type ByokConnectionRow,
} from '@/shared/ai/gateway/byok-model-conversion'

type UserConnectionCache = {
  connections: ByokConnectionRow[] | null
  inFlight: Promise<ByokConnectionRow[]> | null
  listeners: Set<(connections: ByokConnectionRow[]) => void>
}

const cacheByUser = new Map<string, UserConnectionCache>()
let activeRegistryUserId: string | null = null

function cacheFor(userId: string): UserConnectionCache {
  const existing = cacheByUser.get(userId)
  if (existing) return existing
  const created: UserConnectionCache = {
    connections: null,
    inFlight: null,
    listeners: new Set(),
  }
  cacheByUser.set(userId, created)
  return created
}

function setCachedConnections(userId: string, connections: ByokConnectionRow[]): void {
  const cache = cacheFor(userId)
  cache.connections = connections
  if (activeRegistryUserId === userId) registerByokModels(connections)
  cache.listeners.forEach((listener) => listener(connections))
}

function payloadErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const error = (payload as { error?: unknown }).error
  return typeof error === 'string' && error.trim() ? error : null
}

export function normalizeByokConnectionsPayload(payload: unknown): ByokConnectionRow[] {
  const candidate = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? (payload as { data?: unknown; connections?: unknown; items?: unknown }).data ??
        (payload as { data?: unknown; connections?: unknown; items?: unknown }).connections ??
        (payload as { data?: unknown; connections?: unknown; items?: unknown }).items
      : undefined

  if (!Array.isArray(candidate)) {
    throw new Error(payloadErrorMessage(payload) ?? 'Invalid BYOK provider connections response')
  }

  return candidate.filter(isByokConnectionRow)
}

async function loadConnections(userId: string, force = false): Promise<ByokConnectionRow[]> {
  const cache = cacheFor(userId)
  if (!force && cache.connections) return cache.connections
  if (!force && cache.inFlight) return cache.inFlight
  cache.inFlight = fetch('/api/v1/providers/connections', {
    cache: 'no-store',
    credentials: 'same-origin',
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payloadErrorMessage(payload) ?? 'Failed to load BYOK provider connections')
      }
      const connections = normalizeByokConnectionsPayload(payload)
      setCachedConnections(userId, connections)
      return connections
    })
    .finally(() => {
      cache.inFlight = null
    })
  return cache.inFlight
}

export function useByokModels({ enabled = true }: { enabled?: boolean } = {}) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const initialConnections = userId ? cacheFor(userId).connections : null
  const [connections, setConnections] = useState<ByokConnectionRow[]>(() => initialConnections ?? [])
  const [isLoading, setIsLoading] = useState(enabled && Boolean(userId) && !initialConnections)
  const [error, setError] = useState<string | null>(null)

  const updateConnection = useCallback((
    connectionId: string,
    patch: Partial<Pick<ByokConnectionRow, 'enabledModelIds' | 'status' | 'lastError' | 'lastTestedAt' | 'discoveredModelsJson' | 'discoveredAt' | 'displayName' | 'endpoint'>>,
  ) => {
    if (!userId) return
    const cache = cacheFor(userId)
    if (!cache.connections) return
    setCachedConnections(
      userId,
      cache.connections.map((connection) =>
        connection._id === connectionId ? { ...connection, ...patch } : connection,
      ),
    )
  }, [userId])

  const refresh = useCallback(async () => {
    if (!enabled || !userId) return
    setIsLoading(true)
    setError(null)
    try {
      const next = await loadConnections(userId, true)
      setConnections(next)
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Failed to load connections')
    } finally {
      setIsLoading(false)
    }
  }, [enabled, userId])

  useEffect(() => {
    if (!enabled || !userId) {
      setConnections([])
      setIsLoading(false)
      setError(null)
      registerByokModels([])
      return
    }
    const cache = cacheFor(userId)
    activeRegistryUserId = userId
    cache.listeners.add(setConnections)
    if (cache.connections) {
      setConnections(cache.connections)
      registerByokModels(cache.connections)
      setIsLoading(false)
      setError(null)
      return () => {
        cache.listeners.delete(setConnections)
        if (cache.listeners.size === 0 && activeRegistryUserId === userId) {
          activeRegistryUserId = null
          registerByokModels([])
        }
      }
    }
    let active = true
    setConnections([])
    setIsLoading(true)
    setError(null)
    void loadConnections(userId)
      .then((next) => {
        if (active) {
          setConnections(next)
          setError(null)
        }
      })
      .catch((value) => {
        if (active) setError(value instanceof Error ? value.message : 'Failed to load connections')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
      cache.listeners.delete(setConnections)
      if (cache.listeners.size === 0 && activeRegistryUserId === userId) {
        activeRegistryUserId = null
        registerByokModels([])
      }
    }
  }, [enabled, userId])

  return { connections, isLoading, error, refresh, updateConnection }
}
