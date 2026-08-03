import type { GatewayCatalogModel } from '@/shared/ai/gateway/gateway-catalog'
import {
  DEFAULT_CURATED_CHAT_MODEL_IDS,
  OVERLAY_FREE_CHAT_MODELS,
} from '@/shared/ai/gateway/model-data'
import type { ChatModel } from '@/shared/ai/gateway/model-types'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'
import {
  byokModelId,
  formatByokModelDisplayName,
  parseDiscoveredModels,
} from '@/shared/ai/gateway/byok-model-conversion'

// ─── Types ───

export interface DiscoveredModel {
  id: string
  name?: string
}
export type DialogState =
  | { mode: 'add' }
  | { mode: 'edit'; connection: ByokConnectionRow }
  | null

export type ProviderModelOption = {
  rawId: string
  appModelId: string
  name: string
  provider?: string
  supportsVision?: boolean
  supportsReasoning?: boolean
  inputPricePerMillion?: number
  outputPricePerMillion?: number
  isDefault?: boolean
}

// ─── Helpers ───

export function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return 'Never'
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatPrice(value?: number) {
  if (value === undefined) return 'Unpriced'
  if (value === 0) return 'Free'
  return `$${value < 0.01 ? value.toFixed(3) : value.toFixed(2)}/1M`
}

export function isDefaultGatewayConnection(connection: ByokConnectionRow): boolean {
  return connection.isDefault && connection.providerId === 'vercel-ai-gateway'
}

export function providerModelId(connection: ByokConnectionRow, rawModelId: string): string {
  return isDefaultGatewayConnection(connection) ? rawModelId : byokModelId(connection._id, rawModelId)
}

export function getDiscoveredModelCount(connection: ByokConnectionRow): number {
  return parseDiscoveredModels(connection.discoveredModelsJson).length
}

export function getEffectiveSettingsModelIds(enabledModelIds: readonly string[]): string[] {
  return enabledModelIds.length > 0
    ? [...enabledModelIds]
    : [...DEFAULT_CURATED_CHAT_MODEL_IDS]
}

export function payloadErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const error = (payload as { error?: unknown }).error
  return typeof error === 'string' && error.trim() ? error : null
}

export function gatewayModelToOption(model: GatewayCatalogModel): ProviderModelOption | null {
  if (model.type !== 'language') return null
  return {
    rawId: model.id,
    appModelId: model.id,
    name: model.name,
    provider: model.provider,
    supportsVision: model.tags.includes('vision'),
    supportsReasoning: model.tags.includes('reasoning'),
    inputPricePerMillion: model.inputPricePerMillion,
    outputPricePerMillion: model.outputPricePerMillion,
    isDefault: DEFAULT_CURATED_CHAT_MODEL_IDS.includes(model.id as typeof DEFAULT_CURATED_CHAT_MODEL_IDS[number]),
  }
}

export function freeChatModelToOption(model: ChatModel): ProviderModelOption {
  return {
    rawId: model.id,
    appModelId: model.id,
    name: model.name,
    provider: model.provider,
    supportsVision: model.supportsVision,
    supportsReasoning: model.supportsReasoning,
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    isDefault: DEFAULT_CURATED_CHAT_MODEL_IDS.includes(model.id as typeof DEFAULT_CURATED_CHAT_MODEL_IDS[number]),
  }
}

export function buildProviderModelOptions(
  connection: ByokConnectionRow,
  gatewayModels: readonly GatewayCatalogModel[],
): ProviderModelOption[] {
  if (isDefaultGatewayConnection(connection)) {
    const options = [
      ...gatewayModels
        .map(gatewayModelToOption)
        .filter((model): model is ProviderModelOption => Boolean(model)),
      ...OVERLAY_FREE_CHAT_MODELS.map(freeChatModelToOption),
    ]
    const seen = new Set<string>()
    return options
      .filter((model) => {
        if (seen.has(model.appModelId)) return false
        seen.add(model.appModelId)
        return true
      })
      .sort((a, b) => (a.provider ?? '').localeCompare(b.provider ?? '') || a.name.localeCompare(b.name))
  }

  return parseDiscoveredModels(connection.discoveredModelsJson)
    .map((model) => ({
      rawId: model.id,
      appModelId: providerModelId(connection, model.id),
      name: formatByokModelDisplayName(model.id, model.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function filterModels(models: readonly ProviderModelOption[], query: string): ProviderModelOption[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return [...models]
  return models.filter((model) =>
    `${model.name} ${model.rawId} ${model.provider ?? ''}`.toLowerCase().includes(normalized),
  )
}
