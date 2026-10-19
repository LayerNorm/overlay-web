import {
  asRecord,
  freeEndpointCapabilities,
  hasZeroPricing,
  type FreeRouteCapabilities,
} from '@/shared/ai/gateway/overlay-free-policy'

export function parseGatewayModels(payload: unknown): Record<string, unknown>[] {
  const rows = asRecord(payload).data
  return Array.isArray(rows) ? rows.map(asRecord) : []
}

export function parseGatewayEndpoints(payload: unknown): Record<string, unknown>[] {
  const data = asRecord(asRecord(payload).data)
  return Array.isArray(data.endpoints) ? data.endpoints.map(asRecord) : []
}

export function gatewayModelHasZeroPricing(model: unknown): boolean {
  const value = asRecord(model)
  return value.type === 'language' && hasZeroPricing(value.pricing, ['input', 'output'])
}

export function endpointHasZeroPricing(endpoint: unknown): boolean {
  return hasZeroPricing(asRecord(endpoint).pricing, ['input', 'output'])
}

export function openRouterFreeModelHasZeroPricing(model: unknown): boolean {
  const value = asRecord(model)
  return value.id === 'openrouter/free' && hasZeroPricing(value.pricing, ['prompt', 'completion'])
}

export function currentGatewayEndpoint(
  payload: unknown,
  modelId: string,
  provider: string,
): { capabilities: FreeRouteCapabilities; pricing: Record<string, unknown> } | null {
  const endpoint = parseGatewayEndpoints(payload).find((row) => row.provider_name === provider)
  if (!endpoint || !endpointHasZeroPricing(endpoint)) return null
  const capabilities = freeEndpointCapabilities(endpoint)
  return capabilities
    ? { capabilities, pricing: asRecord(endpoint.pricing) }
    : null
}

export function currentOpenRouterFreeModel(payload: unknown): {
  capabilities: FreeRouteCapabilities
  pricing: Record<string, unknown>
} | null {
  const models = Array.isArray(asRecord(payload).data) ? asRecord(payload).data as unknown[] : []
  const model = models.map(asRecord).find((row) => openRouterFreeModelHasZeroPricing(row))
  if (!model) return null
  const capabilities = freeEndpointCapabilities(model)
  return capabilities ? { capabilities, pricing: asRecord(model.pricing) } : null
}
