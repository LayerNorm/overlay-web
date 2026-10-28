import type { ActionCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import {
  calculateGatewayEmbeddingCostOrNull,
  calculateGatewayLanguageTokenCostOrNull,
} from '../../src/shared/ai/gateway/model-pricing'
import { isFreeTierChatModelId } from '../../src/shared/ai/gateway/model-types'

const CATALOG_URL = 'https://ai-gateway.vercel.sh/v1/models'
const CACHE_TTL_MS = 15 * 60 * 1000

type GatewayModelRow = {
  id?: string
  type?: string
  pricing?: Record<string, unknown>
}

type CatalogCache = {
  fetchedAt: number
  models: GatewayModelRow[]
}

let cache: CatalogCache | null = null

const MODEL_ID_ALIASES: Record<string, string> = {
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4.6',
  'claude-haiku-4-5': 'anthropic/claude-haiku-4.5',
  'gemini-3.1-pro-preview': 'google/gemini-3.1-pro-preview',
  'gemini-3-flash-preview': 'google/gemini-3-flash',
  'gpt-5.4': 'openai/gpt-5.4',
  'gpt-4.1-2025-04-14': 'openai/gpt-4.1',
  'qwen/qwen3.6-plus': 'alibaba/qwen3.6-plus',
  'z-ai/glm-5.1': 'zai/glm-5.1',
  'z-ai/glm-5.3': 'zai/glm-5.3',
  'z-ai/glm-5.3-flash': 'zai/glm-5.3-flash',
}

function parseRows(modelsJson: string): GatewayModelRow[] | null {
  try {
    const value = JSON.parse(modelsJson) as unknown
    return Array.isArray(value) ? value as GatewayModelRow[] : null
  } catch {
    return null
  }
}

async function getCatalog(ctx: ActionCtx): Promise<GatewayModelRow[]> {
  const now = Date.now()
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.models

  const snapshot = await ctx.runQuery(internal.platform.gatewayCatalog.getSnapshotInternal, {})
  const persistedRows = snapshot ? parseRows(snapshot.modelsJson) : null
  if (snapshot && persistedRows && now - snapshot.fetchedAt < CACHE_TTL_MS) {
    cache = { fetchedAt: snapshot.fetchedAt, models: persistedRows }
    return persistedRows
  }

  try {
    const response = await fetch(CATALOG_URL, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Gateway catalog request failed (${response.status})`)
    const payload = await response.json() as { data?: unknown[] }
    if (!Array.isArray(payload.data) || payload.data.length === 0) {
      throw new Error('Gateway catalog returned no models')
    }
    const models = payload.data as GatewayModelRow[]
    const fetchedAt = Date.now()
    await ctx.runMutation(internal.platform.gatewayCatalog.upsertSnapshotInternal, {
      source: CATALOG_URL,
      modelsJson: JSON.stringify(payload.data),
      fetchedAt,
    })
    cache = { fetchedAt, models }
    return models
  } catch (error) {
    if (persistedRows && snapshot) {
      console.warn('[gatewayCatalogPricing] Using stale catalog snapshot', error)
      cache = { fetchedAt: snapshot.fetchedAt, models: persistedRows }
      return persistedRows
    }
    throw error
  }
}

async function findModel(ctx: ActionCtx, modelId: string): Promise<GatewayModelRow | null> {
  const gatewayId = MODEL_ID_ALIASES[modelId] ?? modelId
  return (await getCatalog(ctx)).find((model) => model.id === gatewayId) ?? null
}

export async function calculateGatewayLanguageModelCostOrNull(
  ctx: ActionCtx,
  modelId: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
): Promise<number | null> {
  if (isFreeTierChatModelId(modelId)) return 0
  const model = await findModel(ctx, modelId)
  return model?.type === 'language' && model.pricing
    ? calculateGatewayLanguageTokenCostOrNull(
        model.pricing,
        inputTokens,
        cachedInputTokens,
        outputTokens,
      )
    : null
}

export async function calculateGatewayEmbeddingModelCostOrNull(
  ctx: ActionCtx,
  modelId: string,
  inputTokens: number,
): Promise<number | null> {
  const model = await findModel(ctx, modelId)
  return model?.type === 'embedding' && model.pricing
    ? calculateGatewayEmbeddingCostOrNull(model.pricing, inputTokens)
    : null
}
