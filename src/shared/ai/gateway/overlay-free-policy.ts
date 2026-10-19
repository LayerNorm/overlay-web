export const OVERLAY_FREE_MODEL_ID = 'overlay-free'
export const OPENROUTER_FREE_MODEL_ID = 'openrouter/free'
export const FREE_ROUTE_TTL_MS = 60 * 60 * 1000
export const FREE_ROUTE_LEASE_MS = 3 * 60 * 1000
export const FREE_ROUTE_TIMEOUT_MS = 60 * 1000
export const FREE_ROUTE_COOLDOWN_MS = 60 * 1000

const PREFERRED_MODELS = [
  'minimax/minimax-m3.1-flash',
  'reflection/beam-free',
  'nvidia/nemotron-3.5-lightning-free',
]

export function freeRoutePriority(modelId: string): number {
  const index = PREFERRED_MODELS.indexOf(modelId)
  return index < 0 ? PREFERRED_MODELS.length : index
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function isExplicitZero(value: unknown): boolean {
  if (typeof value === 'number') return value === 0
  // Do not let underflow (e.g. "1e-999") or empty strings authorize inference.
  return typeof value === 'string' && /^\+?0+(?:\.0+)?(?:e[+-]?\d+)?$/i.test(value.trim())
}

export function hasZeroPricing(value: unknown, required: readonly string[] = ['prompt', 'completion']): boolean {
  const pricing = asRecord(value)
  return required.every(key => isExplicitZero(pricing[key])) && Object.entries(pricing).every(([key, cost]) => {
    if (key === 'discount') return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
    if (key === 'varies_by_provider') return typeof cost === 'boolean'
    return isExplicitZero(cost)
  })
}

const COST_FIELDS = [
  'cost', 'gatewayCost', 'marketCost', 'surchargeCost', 'reportingTagWriteCost',
  'gateway_cost', 'market_cost', 'surcharge_cost', 'reporting_tag_write_cost',
] as const

export type FreeReceipt = {
  safe: boolean
  cost: number | null
  reason: string | null
  actualModelId?: string
  actualProvider?: string
}

export function assessFreeReceipt(
  value: unknown,
  expected: { transport: 'gateway' | 'openrouter'; modelId: string; provider: string },
): FreeReceipt {
  const result = asRecord(value)
  const metadata = asRecord(result.providerMetadata)
  const gateway = asRecord(metadata.gateway)
  const openrouter = asRecord(metadata.openrouter)
  const openrouterUsage = asRecord(openrouter.usage)
  const body = asRecord(asRecord(result.response).body)
  const usage = asRecord(body.usage)
  const rawUsage = asRecord(result.usage)
  const sources = expected.transport === 'gateway' ? [gateway, usage, rawUsage] : [openrouter, openrouterUsage, usage, rawUsage]
  const fields = sources.flatMap(source => COST_FIELDS.filter(key => key in source).map(key => source[key]))
  const hasTotal = sources.some(source => 'cost' in source || 'gatewayCost' in source || 'gateway_cost' in source)
  const valid = fields.every(field => (typeof field === 'number' || (typeof field === 'string' && field.trim() !== ''))
    && Number.isFinite(Number(field)) && Number(field) >= 0 && (Number(field) !== 0 || isExplicitZero(field)))
  const cost = hasTotal && fields.length && valid ? Math.max(...fields.map(Number)) : null
  const routing = asRecord(gateway.routing)
  const response = asRecord(result.response)
  const actualModelId = expected.transport === 'gateway' ? routing.canonicalSlug : response.modelId ?? body.model
  const actualProvider = expected.transport === 'gateway' ? routing.finalProvider : 'openrouter'
  const routeMatches = expected.transport === 'openrouter' ||
    (actualProvider === expected.provider && actualModelId === expected.modelId)
  const reason = cost === null ? 'Missing or invalid cost receipt'
    : cost !== 0 ? 'Nonzero provider charge'
      : !routeMatches ? 'Missing or unexpected provider/model routing' : null
  return {
    safe: reason === null, cost, reason,
    ...(typeof actualModelId === 'string' ? { actualModelId } : {}),
    ...(typeof actualProvider === 'string' ? { actualProvider } : {}),
  }
}

export type FreeRouteCapabilities = {
  contextWindow: number
  maxOutputTokens: number
  supportsTools: boolean
  supportsVision: boolean
  supportsJson: boolean
}

export function freeEndpointCapabilities(value: unknown): FreeRouteCapabilities | null {
  const endpoint = asRecord(value)
  const contextWindow = endpoint.context_length
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) return null
  const parameters = Array.isArray(endpoint.supported_parameters) ? endpoint.supported_parameters : []
  const tags = Array.isArray(endpoint.tags) ? endpoint.tags : []
  const architecture = asRecord(endpoint.architecture)
  const modalities = Array.isArray(architecture.input_modalities) ? architecture.input_modalities : []
  const maxOutput = endpoint.max_completion_tokens
  return {
    contextWindow,
    maxOutputTokens: typeof maxOutput === 'number' && Number.isFinite(maxOutput) && maxOutput > 0 ? maxOutput : contextWindow,
    supportsTools: parameters.includes('tools') && parameters.includes('tool_choice'),
    supportsVision: tags.includes('vision') || modalities.includes('image'),
    supportsJson: parameters.includes('response_format') && parameters.includes('structured_outputs'),
  }
}
