/**
 * Isomorphic helpers for converting BYOK (bring-your-own-key) provider
 * connections into {@link ChatModel} objects that merge into the model catalog.
 *
 * This module is shared between client and server (no Node builtins, no
 * server-only imports) so it can be used by Convex handlers, BFF routes, and
 * client hooks alike.
 */

import type { ChatModel } from '@/shared/ai/gateway/model-types'

/** Prefix for all BYOK-namespaced model IDs: `byok/{connectionId}/{rawModelId}`. */
export const BYOK_MODEL_PREFIX = 'byok/'

/** Returns `true` if the model ID is a BYOK-namespaced model. */
export function isByokModelId(modelId: string): boolean {
  return modelId.startsWith(BYOK_MODEL_PREFIX)
}

/**
 * Builds a BYOK-namespaced model ID from a connection ID and raw model ID.
 * Example: `byok/kx7abc123/llama-3.3-70b`
 */
export function byokModelId(connectionId: string, rawModelId: string): string {
  return `${BYOK_MODEL_PREFIX}${connectionId}/${rawModelId}`
}

/**
 * Parses a BYOK model ID into its connection ID and raw model ID components.
 * Returns `null` if the ID is not a valid BYOK model ID.
 */
export function parseByokModelId(
  modelId: string,
): { connectionId: string; rawModelId: string } | null {
  if (!modelId.startsWith(BYOK_MODEL_PREFIX) || modelId.length > 160) return null
  const parts = modelId.slice(BYOK_MODEL_PREFIX.length).split('/')
  const connectionId = parts[0]
  const rawModelId = parts.slice(1).join('/')
  if (
    !connectionId ||
    connectionId.length > 64 ||
    !/^[A-Za-z0-9_-]+$/.test(connectionId) ||
    !rawModelId ||
    rawModelId.length > 100 ||
    !/^[A-Za-z0-9._~:/@+-]+$/.test(rawModelId)
  ) return null
  return { connectionId, rawModelId }
}

// ─── Connection shape (matches the client-facing `list` query output) ───

export interface ByokConnectionRow {
  _id: string
  providerId: string
  endpoint: string
  displayName: string
  enabledModelIds: string[]
  discoveredModelsJson?: string
  discoveredAt?: number
  status: 'active' | 'error' | 'untested'
  lastError?: string
  lastTestedAt?: number
  isDefault: boolean
  isDeletable: boolean
  createdAt?: number
  updatedAt?: number
}

// ─── Discovery response shape (OpenAI-compatible /models) ───

interface DiscoveredModel {
  id: string
  name?: string
}

const MODEL_TOKEN_LABELS: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  claude: 'Claude',
  codegemma: 'CodeGemma',
  deepseek: 'DeepSeek',
  flash: 'Flash',
  gemini: 'Gemini',
  gemma: 'Gemma',
  glm: 'GLM',
  gpt: 'GPT',
  grok: 'Grok',
  instruct: 'Instruct',
  kimi: 'Kimi',
  llama: 'Llama',
  maverick: 'Maverick',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  nemotron: 'Nemotron',
  oss: 'OSS',
  qwen: 'Qwen',
  reasoning: 'Reasoning',
  vl: 'VL',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

export function isByokConnectionRow(value: unknown): value is ByokConnectionRow {
  if (!isRecord(value)) return false
  return (
    typeof value._id === 'string' &&
    typeof value.providerId === 'string' &&
    typeof value.endpoint === 'string' &&
    typeof value.displayName === 'string' &&
    Array.isArray(value.enabledModelIds) &&
    value.enabledModelIds.every((id) => typeof id === 'string') &&
    (value.status === 'active' || value.status === 'error' || value.status === 'untested') &&
    typeof value.isDefault === 'boolean' &&
    typeof value.isDeletable === 'boolean'
  )
}

/**
 * Parses the `discoveredModelsJson` field of a connection into a list of
 * `{ id, name }` models. Returns an empty array if the JSON is missing or
 * cannot be parsed.
 */
export function parseDiscoveredModels(json: string | undefined): DiscoveredModel[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as { data?: DiscoveredModel[] } | DiscoveredModel[]
    const candidates = Array.isArray(parsed) ? parsed : parsed.data
    if (!Array.isArray(candidates)) return []
    const seen = new Set<string>()
    return candidates.filter((model) => {
      if (!isRecord(model) || typeof model.id !== 'string') return false
      const id = model.id.trim()
      if (!id || id.length > 100 || !/^[A-Za-z0-9._~:/@+-]+$/.test(id) || seen.has(id)) {
        return false
      }
      seen.add(id)
      return true
    }).slice(0, 400) as DiscoveredModel[]
  } catch {
    return []
  }
}

function formatByokModelToken(token: string): string {
  const normalized = token.toLowerCase()
  const mapped = MODEL_TOKEN_LABELS[normalized]
  if (mapped) return mapped
  if (/^\d+(b|m|k)$/i.test(token)) return token.toUpperCase()
  if (/^[a-z]\d+(?:\.\d+)*$/i.test(token)) return token.toUpperCase()
  if (/^\d+(?:\.\d+)*[a-z]?$/i.test(token)) return token.toUpperCase()
  return `${token.charAt(0).toUpperCase()}${token.slice(1)}`
}

/**
 * Builds a human-readable label from provider slug IDs when `/models` does not
 * return a real display name.
 */
export function formatByokModelDisplayName(rawModelId: string, discoveredName?: string): string {
  const trimmedName = discoveredName?.trim()
  const rawLeaf = rawModelId.split('/').pop() ?? rawModelId
  if (trimmedName && trimmedName !== rawModelId && trimmedName !== rawLeaf) {
    return trimmedName
  }

  return rawLeaf
    .replace(/[:_]/g, '-')
    .split('-')
    .filter(Boolean)
    .map(formatByokModelToken)
    .join(' ')
}

/**
 * Converts a single BYOK connection into an array of {@link ChatModel} objects,
 * one per enabled model. Only models in `enabledModelIds` are included — the
 * full discovered list may be larger, but the user selects which to enable.
 *
 * BYOK models use conservative defaults for capabilities (no vision, no
 * reasoning, no search, no ZDR) since we can't guarantee what the provider
 * supports. The user discovers capabilities empirically at runtime.
 */
export function byokConnectionToChatModels(connection: ByokConnectionRow): ChatModel[] {
  if (connection.isDefault && connection.providerId === 'vercel-ai-gateway') return []

  const discovered = parseDiscoveredModels(connection.discoveredModelsJson)
  const discoveredById = new Map(discovered.map((m) => [m.id, m]))

  return connection.enabledModelIds.map((rawModelId) => {
    const discovered = discoveredById.get(rawModelId)
    return {
      id: byokModelId(connection._id, rawModelId),
      name: formatByokModelDisplayName(rawModelId, discovered?.name),
      provider: connection.displayName,
      intelligence: 0,
      cost: 1,
      speedTier: 2,
      supportsVision: false,
      supportsReasoning: false,
      supportsSearch: false,
      supportsZeroDataRetention: false,
    }
  })
}

/**
 * Converts multiple BYOK connections into a flat array of {@link ChatModel}
 * objects, sorted by provider display name then model name.
 */
export function byokConnectionsToChatModels(
  connections: readonly ByokConnectionRow[] | unknown,
): ChatModel[] {
  if (!Array.isArray(connections)) return []
  const models: ChatModel[] = []
  for (const connection of connections) {
    if (!isByokConnectionRow(connection)) continue
    if (connection.status !== 'active') continue
    models.push(...byokConnectionToChatModels(connection))
  }
  return models.sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
  )
}
