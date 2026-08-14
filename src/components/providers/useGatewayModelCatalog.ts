'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GatewayCatalogModel } from '@/shared/ai/gateway/gateway-catalog'
import {
  getGatewayCatalogRevision,
  registerGatewayCatalogModels,
} from '@/shared/ai/gateway/model-data'

let cachedModels: GatewayCatalogModel[] | null = null
let inFlight: Promise<GatewayCatalogModel[]> | null = null
const RETRY_DELAYS_MS = [400, 1_200, 3_000] as const
const MAX_BACKGROUND_RETRY_CYCLES = 3

class CatalogLoadError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterMs?: number) {
    super(message)
    this.name = 'CatalogLoadError'
  }
}

function isRetryableCatalogError(value: unknown): boolean {
  if (!(value instanceof CatalogLoadError)) return true
  if (value.status === undefined) return true
  // 429 is explicitly non-retryable here: the catalog shares the default
  // authenticated rate-limit bucket with other bootstrap read routes, so
  // retrying a 429 against the same exhausted bucket only extends the lockout
  // for every other route (workspaces, settings, conversations). The server
  // returns Retry-After; the caller surfaces it instead of hammering.
  if (value.status === 429) return false
  return value.status === 408 || value.status === 409 || value.status === 425 || value.status >= 500
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function fetchCatalogOnce(force: boolean): Promise<GatewayCatalogModel[]> {
  const response = await fetch(`/api/v1/model-catalog${force ? '?refresh=1' : ''}`, { cache: 'no-store' })
  if (!response.ok) {
    const retryAfterHeader = response.headers.get('retry-after')
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined
    throw new CatalogLoadError(
      `Failed to load the AI Gateway model catalog (${response.status})`,
      response.status,
      Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
    )
  }
  const payload = await response.json() as { models?: GatewayCatalogModel[] }
  return payload.models ?? []
}

async function fetchCatalogWithRetry(force: boolean): Promise<GatewayCatalogModel[]> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetchCatalogOnce(force)
    } catch (error) {
      lastError = error
      if (!isRetryableCatalogError(error)) break
      const delay = RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await wait(delay)
    }
  }
  throw lastError
}

async function loadCatalog(force = false): Promise<GatewayCatalogModel[]> {
  if (!force && cachedModels) {
    registerGatewayCatalogModels(cachedModels)
    return cachedModels
  }
  if (!force && inFlight) return inFlight
  inFlight = fetchCatalogWithRetry(force)
    .then((models) => {
      cachedModels = models
      registerGatewayCatalogModels(models)
      return models
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Start the catalog fetch as early as possible (app shell), before chat mounts. */
export function prefetchGatewayModelCatalog(): void {
  if (typeof window === 'undefined') return
  // Prefetching is opportunistic. Authentication can expire between the shell
  // deciding to prefetch and this request reaching the server, so never turn a
  // background catalog miss into an unhandled runtime error.
  void loadCatalog().catch(() => undefined)
}

export function useGatewayModelCatalog({ enabled = true }: { enabled?: boolean } = {}) {
  const backgroundRetryCyclesRef = useRef(0)
  const [models, setModels] = useState<GatewayCatalogModel[]>(() => cachedModels ?? [])
  const [revision, setRevision] = useState(() => getGatewayCatalogRevision())
  const [isLoading, setIsLoading] = useState(enabled && !cachedModels)
  const [error, setError] = useState<string | null>(null)
  const [canAutoRetry, setCanAutoRetry] = useState(false)

  const applyCatalog = useCallback((next: GatewayCatalogModel[]) => {
    setModels(next)
    setRevision(getGatewayCatalogRevision())
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled) return
    setIsLoading(true)
    setError(null)
    setCanAutoRetry(false)
    try {
      const next = await loadCatalog(true)
      applyCatalog(next)
      backgroundRetryCyclesRef.current = 0
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Failed to load models')
      setCanAutoRetry(isRetryableCatalogError(value))
    } finally {
      setIsLoading(false)
    }
  }, [applyCatalog, enabled])

  useEffect(() => {
    let active = true
    if (!enabled) {
      setIsLoading(false)
      return () => {
        active = false
      }
    }
    if (cachedModels) {
      registerGatewayCatalogModels(cachedModels)
      applyCatalog(cachedModels)
      setIsLoading(false)
      return () => {
        active = false
      }
    }
    void loadCatalog()
      .then((next) => {
        if (active) {
          applyCatalog(next)
          setCanAutoRetry(false)
          backgroundRetryCyclesRef.current = 0
        }
      })
      .catch((value) => {
        if (active) {
          setError(value instanceof Error ? value.message : 'Failed to load models')
          setCanAutoRetry(isRetryableCatalogError(value))
        }
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [applyCatalog, enabled])

  useEffect(() => {
    if (!enabled || !error || !canAutoRetry || backgroundRetryCyclesRef.current >= MAX_BACKGROUND_RETRY_CYCLES) return
    let cancelled = false
    const delay = 5_000 * (backgroundRetryCyclesRef.current + 1)
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return
      backgroundRetryCyclesRef.current += 1
      void refresh()
    }, delay)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [canAutoRetry, enabled, error, refresh])

  return { models, isLoading, error, refresh, revision }
}
