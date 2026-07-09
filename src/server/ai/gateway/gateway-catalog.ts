import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getOverlayRuntimeConfigSync } from '@/server/config/loadOverlayConfig'
import { logger } from '@/server/observability/logger'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { GatewayCatalogModel } from '@/shared/ai/gateway/gateway-catalog'
import { registerGatewayCatalogModels } from '@/shared/ai/gateway/model-data'

const CATALOG_URL = 'https://ai-gateway.vercel.sh/v1/models'
const CACHE_TTL_MS = 15 * 60 * 1000
const SUPPORTED_TYPES = new Set(['language', 'image', 'video', 'embedding', 'reranking'])

type PersistedSnapshot = {
  source: string
  modelsJson: string
  fetchedAt: number
}

type CatalogCache = {
  fetchedAt: number
  models: GatewayCatalogModel[]
}

let cache: CatalogCache | null = null
let inFlight: Promise<GatewayCatalogModel[]> | null = null

function usesConvexCatalogPersistence(): boolean {
  return getOverlayRuntimeConfigSync().database.provider === 'convex'
}

const GATEWAY_TO_APP_MODEL_ID: Record<string, string> = {
  'anthropic/claude-sonnet-4.6': 'claude-sonnet-4-6',
  'anthropic/claude-haiku-4.5': 'claude-haiku-4-5',
  'google/gemini-3.1-pro-preview': 'gemini-3.1-pro-preview',
  'google/gemini-3-flash': 'gemini-3-flash-preview',
  'openai/gpt-5.4': 'gpt-5.4',
  'openai/gpt-4.1': 'gpt-4.1-2025-04-14',
  'alibaba/qwen3.6-plus': 'qwen/qwen3.6-plus',
  'zai/glm-5.1': 'z-ai/glm-5.1',
}

function pricePerMillion(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined
}

function normalizeModels(values: unknown[]): GatewayCatalogModel[] {
  return values.flatMap((value): GatewayCatalogModel[] => {
    if (!value || typeof value !== 'object') return []
    const row = value as Record<string, unknown>
    if (
      typeof row.id !== 'string' ||
      typeof row.name !== 'string' ||
      typeof row.type !== 'string' ||
      !SUPPORTED_TYPES.has(row.type)
    ) {
      return []
    }
    const pricing = row.pricing && typeof row.pricing === 'object'
      ? row.pricing as Record<string, unknown>
      : {}
    const inputPricePerMillion = pricePerMillion(pricing.input)
    const outputPricePerMillion = pricePerMillion(pricing.output)
    return [{
      id: GATEWAY_TO_APP_MODEL_ID[row.id] ?? row.id,
      gatewayId: row.id,
      name: row.name,
      type: row.type as GatewayCatalogModel['type'],
      provider: typeof row.owned_by === 'string' ? row.owned_by : row.id.split('/')[0] ?? 'unknown',
      ...(typeof row.description === 'string' ? { description: row.description } : {}),
      ...(typeof row.context_window === 'number' ? { contextWindow: row.context_window } : {}),
      ...(typeof row.max_tokens === 'number' ? { maxTokens: row.max_tokens } : {}),
      tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      pricing,
      ...(inputPricePerMillion !== undefined ? { inputPricePerMillion } : {}),
      ...(outputPricePerMillion !== undefined ? { outputPricePerMillion } : {}),
    }]
  }).sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name))
}

function parsePersistedSnapshot(snapshot: PersistedSnapshot | null): CatalogCache | null {
  if (!snapshot) return null
  try {
    const values = JSON.parse(snapshot.modelsJson) as unknown
    if (!Array.isArray(values)) return null
    const models = normalizeModels(values)
    return models.length > 0 ? { fetchedAt: snapshot.fetchedAt, models } : null
  } catch (_error) {
    return null
  }
}

async function readPersistedSnapshot(): Promise<CatalogCache | null> {
  if (!usesConvexCatalogPersistence()) return null
  const snapshot = await convex.query<PersistedSnapshot | null>(
    'platform/gatewayCatalog:getByServer',
    { serverSecret: getInternalApiSecret() },
    { background: true, suppressNetworkConsoleError: true },
  )
  return parsePersistedSnapshot(snapshot)
}

async function fetchAndPersistCatalog(): Promise<GatewayCatalogModel[]> {
  const response = await fetch(CATALOG_URL, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`AI Gateway catalog request failed (${response.status})`)
  const payload = await response.json() as { data?: unknown[] }
  const values = Array.isArray(payload.data) ? payload.data : []
  const models = normalizeModels(values)
  if (models.length === 0) throw new Error('AI Gateway catalog returned no usable models')
  registerGatewayCatalogModels(models)
  const fetchedAt = Date.now()
  if (usesConvexCatalogPersistence()) {
    await convex.mutation('platform/gatewayCatalog:upsertByServer', {
      serverSecret: getInternalApiSecret(),
      source: CATALOG_URL,
      modelsJson: JSON.stringify(values),
      fetchedAt,
    }, { throwOnError: true })
  }
  cache = { fetchedAt, models }
  return models
}

async function loadCatalog(force: boolean): Promise<GatewayCatalogModel[]> {
  const now = Date.now()
  if (!force && cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.models

  const persisted = await readPersistedSnapshot()
  if (!force && persisted && now - persisted.fetchedAt < CACHE_TTL_MS) {
    cache = persisted
    return persisted.models
  }

  try {
    return await fetchAndPersistCatalog()
  } catch (error) {
    const fallback = persisted ?? cache
    if (fallback) {
      logger.warn('[ai/gateway] Using stale persisted model catalog', {
        fetchedAt: fallback.fetchedAt,
        error: error instanceof Error ? error.message : String(error),
      })
      cache = fallback
      return fallback.models
    }
    throw error
  }
}

export async function getGatewayCatalog(force = false): Promise<GatewayCatalogModel[]> {
  if (!force && inFlight) return inFlight
  inFlight = loadCatalog(force).finally(() => {
    inFlight = null
  })
  const models = await inFlight
  registerGatewayCatalogModels(models)
  return models
}

export async function getGatewayLanguageCatalog(force = false): Promise<GatewayCatalogModel[]> {
  return (await getGatewayCatalog(force)).filter((model) => model.type === 'language')
}

export async function getGatewayCatalogModel(modelId: string): Promise<GatewayCatalogModel | null> {
  const models = await getGatewayCatalog()
  return models.find((model) => model.id === modelId || model.gatewayId === modelId) ?? null
}
