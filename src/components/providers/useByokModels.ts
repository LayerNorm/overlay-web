'use client'

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useOptionalWorkspace } from '@/contexts/WorkspaceContext'
import { registerByokModels } from '@/shared/ai/gateway/model-data'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
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
let activeRegistryScopeKey: string | null = null

export function byokConnectionScopeKey(userId: string, workspaceId?: string | null): string {
  return `${userId}\u0000${workspaceId ?? 'personal'}`
}

export function canApplyByokConnectionResponse(
  activeScopeKey: string | null,
  responseScopeKey: string,
): boolean {
  return activeScopeKey === responseScopeKey
}

function cacheFor(scopeKey: string): UserConnectionCache {
  const existing = cacheByUser.get(scopeKey)
  if (existing) return existing
  const created: UserConnectionCache = {
    connections: null,
    inFlight: null,
    listeners: new Set(),
  }
  cacheByUser.set(scopeKey, created)
  return created
}

function setCachedConnections(scopeKey: string, connections: ByokConnectionRow[]): void {
  const cache = cacheFor(scopeKey)
  cache.connections = connections
  if (canApplyByokConnectionResponse(activeRegistryScopeKey, scopeKey)) {
    registerByokModels(connections)
    cache.listeners.forEach((listener) => listener(connections))
  }
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

async function loadConnections(
  userId: string,
  workspaceId: string | null,
  scopeKey: string,
  force = false,
): Promise<ByokConnectionRow[]> {
  const cache = cacheFor(scopeKey)
  if (!force && cache.connections) return cache.connections
  if (cache.inFlight) return cache.inFlight
  // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check
  cache.inFlight = fetch('/api/v1/providers/connections', {
    cache: 'no-store',
    credentials: 'same-origin',
    ...(workspaceId ? { headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId } } : {}),
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payloadErrorMessage(payload) ?? 'Failed to load BYOK provider connections')
      }
      const connections = normalizeByokConnectionsPayload(payload)
      if (canApplyByokConnectionResponse(activeRegistryScopeKey, scopeKey)) {
        setCachedConnections(scopeKey, connections)
      }
      return connections
    })
    .finally(() => {
      cache.inFlight = null
    })
  return cache.inFlight
}

export function useByokModels({ enabled = true }: { enabled?: boolean } = {}) {
  const { user } = useAuth()
  const workspace = useOptionalWorkspace()
  const userId = user?.id ?? null
  const workspaceId = workspace?.activeWorkspaceId ?? null
  const scopeKey = userId ? byokConnectionScopeKey(userId, workspaceId) : null
  const initialConnections = scopeKey ? cacheFor(scopeKey).connections : null
  const [connectionSnapshot, setConnectionSnapshot] = useState(() => ({
    scopeKey,
    connections: initialConnections ?? [],
  }))
  const connections = connectionSnapshot.scopeKey === scopeKey
    ? connectionSnapshot.connections
    : []
  const setConnections = useCallback((value: ByokConnectionRow[]) => {
    setConnectionSnapshot({ scopeKey, connections: value })
  }, [scopeKey])
  const [isLoading, setIsLoading] = useState(enabled && Boolean(scopeKey) && !initialConnections)
  const [error, setError] = useState<string | null>(null)

  useLayoutEffect(() => {
    const nextScopeKey = enabled ? scopeKey : null
    if (activeRegistryScopeKey === nextScopeKey) return
    activeRegistryScopeKey = nextScopeKey
    registerByokModels([])
  }, [enabled, scopeKey])

  const updateConnection = useCallback((
    connectionId: string,
    patch: Partial<Pick<ByokConnectionRow, 'enabledModelIds' | 'status' | 'lastError' | 'lastTestedAt' | 'discoveredModelsJson' | 'discoveredAt' | 'displayName' | 'endpoint'>>,
  ) => {
    if (!scopeKey) return
    const cache = cacheFor(scopeKey)
    if (!cache.connections) return
    setCachedConnections(
      scopeKey,
      cache.connections.map((connection) =>
        connection._id === connectionId ? { ...connection, ...patch } : connection,
      ),
    )
  }, [scopeKey])

  const refresh = useCallback(async () => {
    if (!enabled || !userId || !scopeKey) return
    setIsLoading(true)
    setError(null)
    try {
      const next = await loadConnections(userId, workspaceId, scopeKey, true)
      if (canApplyByokConnectionResponse(activeRegistryScopeKey, scopeKey)) {
        setConnections(next)
      }
    } catch (value) {
      if (canApplyByokConnectionResponse(activeRegistryScopeKey, scopeKey)) {
        setError(value instanceof Error ? value.message : 'Failed to load connections')
      }
    } finally {
      if (canApplyByokConnectionResponse(activeRegistryScopeKey, scopeKey)) setIsLoading(false)
    }
  }, [enabled, scopeKey, setConnections, userId, workspaceId])

  useEffect(() => {
    if (!enabled || !userId || !scopeKey) return
    const revalidate = () => {
      if (document.visibilityState !== 'visible') return
      void loadConnections(userId, workspaceId, scopeKey, true).catch(() => {})
    }
    window.addEventListener('focus', revalidate)
    const timer = window.setInterval(revalidate, 60_000)
    return () => {
      window.removeEventListener('focus', revalidate)
      window.clearInterval(timer)
    }
  }, [enabled, scopeKey, userId, workspaceId])

  // Client-side data load on mount — no server data layer in this app.
  // react-doctor-disable-next-line react-doctor/no-fetch-in-effect
  useEffect(() => {
    if (!enabled || !userId || !scopeKey) {
      setConnections([])
      setIsLoading(false)
      setError(null)
      if (activeRegistryScopeKey !== null) {
        activeRegistryScopeKey = null
        registerByokModels([])
      }
      return
    }
    if (activeRegistryScopeKey !== scopeKey) {
      registerByokModels([])
      activeRegistryScopeKey = scopeKey
    }
    const cache = cacheFor(scopeKey)
    cache.listeners.add(setConnections)
    if (cache.connections) {
      setConnections(cache.connections)
      registerByokModels(cache.connections)
      setIsLoading(false)
      setError(null)
      return () => {
        cache.listeners.delete(setConnections)
        if (cache.listeners.size === 0 && activeRegistryScopeKey === scopeKey) {
          activeRegistryScopeKey = null
          registerByokModels([])
        }
      }
    }
    let active = true
    setConnections([])
    setIsLoading(true)
    setError(null)
    void loadConnections(userId, workspaceId, scopeKey)
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
      if (cache.listeners.size === 0 && activeRegistryScopeKey === scopeKey) {
        activeRegistryScopeKey = null
        registerByokModels([])
      }
    }
  }, [enabled, scopeKey, setConnections, userId, workspaceId])

  return { connections, isLoading, error, refresh, updateConnection }
}
