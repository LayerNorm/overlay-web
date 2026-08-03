import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { readByokVaultKey } from '@/server/ai/gateway/byok-vault'
import { createByokProviderFetch } from '@/server/ai/gateway/byok-provider-fetch'
import { getGatewayLanguageCatalog } from '@/server/ai/gateway/gateway-catalog'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { validatePublicNetworkUrl } from '@/server/security/ssrf'
import { getByokPreset } from '@overlay/llm-gateway'
import {
  byokEndpointMatchesPreset,
  resolveByokEndpointForCreate,
  resolveByokEndpointForPatch,
} from '@/server/ai/gateway/byok-security'
import { overlayProviderDiscoveryModels } from '@/server/ai/gateway/overlay-provider-models'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'

const MAX_API_KEY_LENGTH = 16_384
const MAX_DISCOVERY_BYTES = 1_000_000
const MAX_DISCOVERED_MODELS = 400
const MAX_MODEL_ID_LENGTH = 100
const MODEL_ID_PATTERN = /^[A-Za-z0-9._~:/@+-]+$/
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function readLimitedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_DISCOVERY_BYTES) {
    throw new Error('Provider model response is too large')
  }

  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytesRead += value.byteLength
    if (bytesRead > MAX_DISCOVERY_BYTES) {
      await reader.cancel()
      throw new Error('Provider model response is too large')
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

function normalizeDiscoveredModels(payload: unknown): Array<{ id: string; name: string }> {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return []
  const seen = new Set<string>()
  const models: Array<{ id: string; name: string }> = []
  for (const candidate of payload.data) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string') continue
    const id = candidate.id.trim()
    if (
      !id ||
      id.length > MAX_MODEL_ID_LENGTH ||
      !MODEL_ID_PATTERN.test(id) ||
      seen.has(id)
    ) continue
    seen.add(id)
    const name = typeof candidate.name === 'string' && candidate.name.trim()
      ? candidate.name.trim().slice(0, 200)
      : id
    models.push({ id, name })
    if (models.length >= MAX_DISCOVERED_MODELS) break
  }
  return models
}

// POST /api/v1/providers/connections/test
// Tests a known provider's model-discovery endpoint. Redirects are rejected so
// an Authorization header can never be forwarded to a second origin. Custom
// endpoints also use socket-time DNS/IP validation to prevent DNS rebinding.
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json().catch((_error) => null)
    if (!isRecord(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { connectionId, providerId, endpoint, apiKey } = body
    const serverSecret = getInternalApiSecret()
    let resolvedProviderId = typeof providerId === 'string' ? providerId : ''
    let resolvedEndpoint = ''
    let resolvedApiKey = typeof apiKey === 'string' ? apiKey.trim() : ''

    if (resolvedApiKey.length > MAX_API_KEY_LENGTH) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 400 })
    }

    if (connectionId !== undefined && (
      typeof connectionId !== 'string' || !CONNECTION_ID_PATTERN.test(connectionId)
    )) {
      return NextResponse.json({ error: 'Invalid connectionId' }, { status: 400 })
    }

    if (typeof connectionId === 'string' && connectionId) {
      const existing = await convex.query<{
        userId: string
        providerId: string
        endpoint: string
        vaultObjectId?: string
        isDefault: boolean
      } | null>(
        'providers/connections:getByServer',
        { serverSecret, connectionId },
        { throwOnError: true },
      )

      if (!existing || existing.userId !== context.auth.userId) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
      }

      if (existing.isDefault && existing.providerId === 'vercel-ai-gateway') {
        const models = overlayProviderDiscoveryModels(await getGatewayLanguageCatalog(true))
        return NextResponse.json({ ok: true, models })
      }

      const existingPreset = getByokPreset(existing.providerId)
      if (!existingPreset || !byokEndpointMatchesPreset(existing.providerId, existing.endpoint)) {
        return NextResponse.json({ error: 'Connection endpoint is not allowed' }, { status: 403 })
      }

      resolvedProviderId = existing.providerId
      if (endpoint !== undefined) {
        const resolution = resolveByokEndpointForPatch(
          existing.providerId,
          endpoint,
          { isDefault: existing.isDefault },
        )
        if (!resolution.ok) {
          return NextResponse.json(
            { error: resolution.error },
            { status: resolution.status },
          )
        }
        resolvedEndpoint = resolution.endpoint ?? existing.endpoint
      } else {
        resolvedEndpoint = existing.endpoint
      }
      if (!resolvedApiKey && existing.vaultObjectId) {
        resolvedApiKey = await readByokVaultKey(existing.vaultObjectId) ?? ''
      }
    } else {
      if (!resolvedProviderId) {
        return NextResponse.json({ error: 'providerId is required' }, { status: 400 })
      }
      const resolution = resolveByokEndpointForCreate(resolvedProviderId, endpoint)
      if (!resolution.ok) {
        return NextResponse.json(
          { error: resolution.error },
          { status: resolution.status },
        )
      }
      resolvedEndpoint = resolution.endpoint
    }

    const preset = getByokPreset(resolvedProviderId)
    if (!preset || preset.isDefault) {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
    }

    const urlResult = await validatePublicNetworkUrl(resolvedEndpoint, {
      allowLocalDev: false,
      requireHttps: true,
    })
    if (!urlResult.ok) {
      return NextResponse.json({ error: urlResult.error }, { status: 400 })
    }

    if (preset.requiresApiKey && !resolvedApiKey) {
      return NextResponse.json(
        { error: `API key is required for ${preset.label}` },
        { status: 400 },
      )
    }

    const discoveryUrl = `${resolvedEndpoint.replace(/\/$/, '')}${preset.discoveryPath}`
    const providerFetch = createByokProviderFetch(resolvedEndpoint)
    const response = await providerFetch(discoveryUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...preset.headers,
        ...(resolvedApiKey ? { Authorization: `Bearer ${resolvedApiKey}` } : {}),
      },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, models: [], error: `Provider returned HTTP ${response.status}` },
        { status: 502 },
      )
    }

    const text = await readLimitedText(response)
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch (_error) {
      return NextResponse.json(
        { ok: false, models: [], error: 'Provider returned an invalid model response' },
        { status: 502 },
      )
    }
    return NextResponse.json({ ok: true, models: normalizeDiscoveredModels(payload) })
  } catch (error) {
    logger.warn('[BYOK] Provider connection test failed', summarizeErrorForLog(error))
    return NextResponse.json(
      { ok: false, models: [], error: 'Connection test failed' },
      { status: 502 },
    )
  }
}
