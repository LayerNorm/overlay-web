import 'server-only'

import { getByokPreset } from '@overlay/llm-gateway'

export const DEFAULT_GATEWAY_PROVIDER_ID = 'vercel-ai-gateway'
export const CUSTOM_BYOK_PROVIDER_ID = 'custom-openai-compatible'
const MAX_ENDPOINT_LENGTH = 2_048

export type ByokRuntimeConnectionForSecurity = {
  providerId: string
  endpoint: string
  enabledModelIds: readonly string[]
  isDefault: boolean
  status: string
}

type EndpointResolution =
  | { ok: true; endpoint: string }
  | { ok: false; error: string; status: 400 | 403 }

type OptionalEndpointResolution =
  | { ok: true; endpoint?: string }
  | { ok: false; error: string; status: 400 | 403 }

function parseEndpointInput(endpoint: unknown): string | null | undefined {
  if (endpoint === undefined) return undefined
  if (typeof endpoint !== 'string') return null
  const trimmed = endpoint.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_ENDPOINT_LENGTH ? trimmed : null
}

export function normalizeByokEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '')
}

function normalizeCustomByokEndpoint(endpoint: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch (_error) {
    return null
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) return null

  const pathname = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.origin}${pathname}`
}

export function byokEndpointMatchesPreset(providerId: string, endpoint: string): boolean {
  const preset = getByokPreset(providerId)
  if (!preset) return false
  if (preset.allowsCustomEndpoint) return normalizeCustomByokEndpoint(endpoint) !== null
  if (!preset.defaultBaseURL) return false
  return normalizeByokEndpoint(endpoint) === normalizeByokEndpoint(preset.defaultBaseURL)
}

export function resolveByokEndpointForCreate(
  providerId: string,
  endpoint: unknown,
): EndpointResolution {
  const preset = getByokPreset(providerId)
  if (!preset) {
    return { ok: false, status: 400, error: `Unknown provider: ${providerId}` }
  }
  if (preset.isDefault) {
    return {
      ok: false,
      status: 403,
      error: `${preset.label} is managed automatically and cannot be created as a BYOK provider.`,
    }
  }

  const requested = parseEndpointInput(endpoint)
  if (requested === null) {
    return { ok: false, status: 400, error: 'endpoint must be a non-empty string' }
  }

  if (preset.allowsCustomEndpoint) {
    if (requested === undefined) {
      return { ok: false, status: 400, error: 'API base URL is required' }
    }
    const normalized = normalizeCustomByokEndpoint(requested)
    if (!normalized) {
      return {
        ok: false,
        status: 400,
        error: 'API base URL must be an HTTPS URL without credentials, query parameters, or a fragment',
      }
    }
    return { ok: true, endpoint: normalized }
  }

  if (requested !== undefined && !byokEndpointMatchesPreset(providerId, requested)) {
    return {
      ok: false,
      status: 403,
      error: `${preset.label} endpoint cannot be changed.`,
    }
  }
  return { ok: true, endpoint: preset.defaultBaseURL }
}

export function resolveByokEndpointForPatch(
  providerId: string,
  endpoint: unknown,
  options: { isDefault?: boolean } = {},
): OptionalEndpointResolution {
  if (endpoint === undefined) return { ok: true }

  const preset = getByokPreset(providerId)
  if (!preset) {
    return { ok: false, status: 400, error: `Unknown provider: ${providerId}` }
  }
  if (options.isDefault) {
    return {
      ok: false,
      status: 403,
      error: `${preset.label} endpoint cannot be changed.`,
    }
  }

  const requested = parseEndpointInput(endpoint)
  if (!requested) {
    return { ok: false, status: 400, error: 'endpoint must be a non-empty string' }
  }

  if (preset.allowsCustomEndpoint) {
    const normalized = normalizeCustomByokEndpoint(requested)
    if (!normalized) {
      return {
        ok: false,
        status: 400,
        error: 'API base URL must be an HTTPS URL without credentials, query parameters, or a fragment',
      }
    }
    return { ok: true, endpoint: normalized }
  }

  if (!byokEndpointMatchesPreset(providerId, requested)) {
    return {
      ok: false,
      status: 403,
      error: `${preset.label} endpoint cannot be changed.`,
    }
  }
  return { ok: true, endpoint: preset.defaultBaseURL }
}

export function assertByokRuntimeConnectionAllowed(
  connection: ByokRuntimeConnectionForSecurity,
  rawModelId: string,
): void {
  if (connection.isDefault || connection.providerId === DEFAULT_GATEWAY_PROVIDER_ID) {
    throw new Error('The default Overlay connection cannot be used through BYOK model IDs.')
  }

  if (connection.status !== 'active') {
    throw new Error('This BYOK provider connection is not active. Test it again in Settings -> Providers.')
  }

  if (!connection.enabledModelIds.includes(rawModelId)) {
    throw new Error('This BYOK model is not enabled for the selected provider connection.')
  }

  const preset = getByokPreset(connection.providerId)
  if (!preset) {
    throw new Error('This BYOK provider is not supported.')
  }
  if (!byokEndpointMatchesPreset(connection.providerId, connection.endpoint)) {
    throw new Error(
      preset.allowsCustomEndpoint
        ? `${preset.label} has an invalid API base URL.`
        : `${preset.label} endpoint does not match the locked provider endpoint.`,
    )
  }
}
