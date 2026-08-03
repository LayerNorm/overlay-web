import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { validatePublicNetworkUrl } from '@/server/security/ssrf'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'
import {
  writeByokVaultKey,
  updateByokVaultKey,
  deleteByokVaultKey,
  byokVaultKeyName,
  type ByokVaultKeyContext,
} from '@/server/ai/gateway/byok-vault'
import { getGatewayLanguageCatalog } from '@/server/ai/gateway/gateway-catalog'
import { getByokPreset } from '@overlay/llm-gateway'
import {
  DEFAULT_GATEWAY_PROVIDER_ID,
  byokEndpointMatchesPreset,
  normalizeByokEndpoint,
  resolveByokEndpointForCreate,
  resolveByokEndpointForPatch,
} from '@/server/ai/gateway/byok-security'
import { overlayProviderDiscoveryModels } from '@/server/ai/gateway/overlay-provider-models'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'

const MAX_CONNECTIONS_PER_USER = 20
const MAX_DISPLAY_NAME_LENGTH = 80
const MAX_API_KEY_LENGTH = 16_384
const MAX_MODEL_IDS = 400
// Leaves room for `byok/{convexConnectionId}/` within the 160-character app model limit.
const MAX_MODEL_ID_LENGTH = 100
const MAX_DISCOVERY_JSON_LENGTH = 1_000_000
const MAX_LAST_ERROR_LENGTH = 500
const MODEL_ID_PATTERN = /^[A-Za-z0-9._~:/@+-]+$/
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= MAX_DISPLAY_NAME_LENGTH ? trimmed : null
}

function normalizedApiKey(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= MAX_API_KEY_LENGTH ? trimmed : null
}

function normalizedModelIds(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_MODEL_IDS) return null
  if (!value.every((id) =>
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= MAX_MODEL_ID_LENGTH &&
    MODEL_ID_PATTERN.test(id)
  )) return null
  return Array.from(new Set(value))
}

function normalizedDiscoveryJson(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > MAX_DISCOVERY_JSON_LENGTH) return null
  try {
    const parsed = JSON.parse(value) as { data?: unknown }
    const models = normalizedModelIds(
      Array.isArray(parsed?.data)
        ? parsed.data.map((model) => isRecord(model) ? model.id : null)
        : null,
    )
    if (!models) return null
    const names = new Map<string, string>()
    for (const model of parsed.data as unknown[]) {
      if (!isRecord(model) || typeof model.id !== 'string') continue
      if (typeof model.name === 'string' && model.name.trim()) {
        names.set(model.id, model.name.trim().slice(0, 200))
      }
    }
    return JSON.stringify({ data: models.map((id) => ({ id, name: names.get(id) ?? id })) })
  } catch (_error) {
    return null
  }
}

async function validateEndpointUrl(url: unknown): Promise<string | null> {
  const result = await validatePublicNetworkUrl(url, { allowLocalDev: false, requireHttps: true })
  return result.ok ? null : result.error
}

function sortConnections(connections: ByokConnectionRow[]): ByokConnectionRow[] {
  return [...connections].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.displayName.localeCompare(b.displayName)
  })
}

function defaultGatewayNeedsSeed(connections: readonly ByokConnectionRow[]): boolean {
  const preset = getByokPreset(DEFAULT_GATEWAY_PROVIDER_ID)
  const existing = connections.find(
    (connection) => connection.providerId === DEFAULT_GATEWAY_PROVIDER_ID && connection.isDefault,
  )
  if (!existing) return true
  return (
    (preset ? existing.displayName !== preset.label : false) ||
    existing.enabledModelIds.length === 0 ||
    !existing.discoveredModelsJson ||
    !byokEndpointMatchesPreset(DEFAULT_GATEWAY_PROVIDER_ID, existing.endpoint)
  )
}

async function ensureDefaultGatewayConnection(
  userId: string,
  serverSecret: string,
  connections: readonly ByokConnectionRow[],
): Promise<ByokConnectionRow[]> {
  if (!defaultGatewayNeedsSeed(connections)) return [...connections]

  const preset = getByokPreset(DEFAULT_GATEWAY_PROVIDER_ID)
  if (!preset) return [...connections]

  const gatewayModels = await getGatewayLanguageCatalog().catch((_error) => [])
  const discoveredModels = overlayProviderDiscoveryModels(gatewayModels)
  const seeded = await convex.mutation<ByokConnectionRow>(
    'providers/connections:ensureDefaultGatewayByServer',
    {
      serverSecret,
      userId,
      endpoint: preset.defaultBaseURL,
      displayName: preset.label,
      enabledModelIds: discoveredModels.map((model) => model.id),
      ...(discoveredModels.length > 0
        ? {
            discoveredModelsJson: JSON.stringify({ data: discoveredModels }),
            discoveredAt: Date.now(),
          }
        : {}),
    },
    { throwOnError: true },
  )
  if (!seeded) return [...connections]

  return [
    seeded,
    ...connections.filter((connection) => connection._id !== seeded._id),
  ]
}

function buildVaultContext(
  userId: string,
  providerId: string,
  connectionId?: string,
): ByokVaultKeyContext {
  return {
    purpose: 'byok-provider-key',
    userId,
    providerId,
    ...(connectionId ? { connectionId } : {}),
  }
}

// GET /api/v1/providers/connections — list the authenticated user's connections
export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const connections = await convex.query<ByokConnectionRow[]>(
      'providers/connections:listPublicByServer',
      {
        serverSecret,
        userId: auth.userId,
      },
      { throwOnError: true },
    )
    const seededConnections = await ensureDefaultGatewayConnection(
      auth.userId,
      serverSecret,
      connections || [],
    )
    const data = sortConnections(seededConnections)
    return NextResponse.json({ data, hasMore: false, total: data.length })
  } catch (error) {
    logger.error('[BYOK] Failed to list provider connections', summarizeErrorForLog(error))
    return NextResponse.json({ error: 'Failed to fetch provider connections' }, { status: 500 })
  }
}

// POST /api/v1/providers/connections — create a new BYOK provider connection
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  let pendingVaultObjectId: string | undefined
  try {
    if (!context.requestIdempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header is required for provider connection creation' },
        { status: 428 },
      )
    }
    const body = await request.json().catch((_error) => null)
    if (!isRecord(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const {
      providerId,
      endpoint,
      displayName,
      apiKey,
      enabledModelIds,
    } = body as Record<string, unknown>

    if (!providerId || typeof providerId !== 'string') {
      return NextResponse.json({ error: 'providerId is required' }, { status: 400 })
    }

    const preset = getByokPreset(providerId)
    if (!preset) {
      return NextResponse.json({ error: `Unknown provider: ${providerId}` }, { status: 400 })
    }

    const endpointResolution = resolveByokEndpointForCreate(providerId, endpoint)
    if (!endpointResolution.ok) {
      return NextResponse.json(
        { error: endpointResolution.error },
        { status: endpointResolution.status },
      )
    }
    const resolvedEndpoint = endpointResolution.endpoint

    // Validate the endpoint URL (SSRF protection)
    const urlError = await validateEndpointUrl(resolvedEndpoint)
    if (urlError) {
      return NextResponse.json({ error: urlError }, { status: 400 })
    }

    const safeDisplayName = normalizedDisplayName(displayName)
    if (!safeDisplayName) {
      return NextResponse.json({ error: 'displayName must be between 1 and 80 characters' }, { status: 400 })
    }

    const safeApiKey = normalizedApiKey(apiKey)
    if (safeApiKey === null) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 400 })
    }
    if (preset.requiresApiKey && !safeApiKey) {
      return NextResponse.json(
        { error: `API key is required for ${preset.label}` },
        { status: 400 },
      )
    }
    const safeEnabledModelIds = normalizedModelIds(enabledModelIds)
    if (safeEnabledModelIds === null) {
      return NextResponse.json({ error: 'Invalid enabledModelIds' }, { status: 400 })
    }

    const existingConnections = await convex.query<ByokConnectionRow[]>(
      'providers/connections:listPublicByServer',
      { serverSecret, userId: auth.userId },
      { throwOnError: true },
    )
    if ((existingConnections?.length ?? 0) >= MAX_CONNECTIONS_PER_USER) {
      return NextResponse.json({ error: 'Provider connection limit reached' }, { status: 409 })
    }

    // 1. Write the API key to WorkOS Vault with an up-front unique key name.
    const vaultKeyName = byokVaultKeyName(auth.userId, crypto.randomUUID())

    if (safeApiKey) {
      pendingVaultObjectId = await writeByokVaultKey(
        vaultKeyName,
        safeApiKey,
        buildVaultContext(auth.userId, providerId),
      )
    }

    // 2. Create the Convex record
    const connectionId = await convex.mutation<string>(
      'providers/connections:createByServer',
      {
        serverSecret,
        userId: auth.userId,
        providerId,
        endpoint: resolvedEndpoint,
        displayName: safeDisplayName,
        vaultKeyName,
        vaultObjectId: pendingVaultObjectId,
        enabledModelIds: safeEnabledModelIds ?? [],
        isDefault: preset.isDefault,
        isDeletable: preset.isDeletable,
      },
      { throwOnError: true },
    )

    if (!connectionId) {
      return NextResponse.json(
        { error: 'Failed to create provider connection' },
        { status: 500 },
      )
    }

    pendingVaultObjectId = undefined
    return NextResponse.json({ id: connectionId })
  } catch (error) {
    if (pendingVaultObjectId) await deleteByokVaultKey(pendingVaultObjectId)
    logger.error('[BYOK] Failed to create provider connection', summarizeErrorForLog(error))
    return NextResponse.json({ error: 'Failed to create provider connection' }, { status: 500 })
  }
}

// PATCH /api/v1/providers/connections — update an existing connection
export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  let newlyCreatedVaultObjectId: string | undefined
  try {
    const body = await request.json().catch((_error) => null)
    if (!isRecord(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const {
      connectionId,
      displayName,
      endpoint,
      apiKey,
      enabledModelIds,
      status,
      lastError,
      lastTestedAt,
      discoveredModelsJson,
      discoveredAt,
    } = body as Record<string, unknown>

    if (typeof connectionId !== 'string' || !CONNECTION_ID_PATTERN.test(connectionId)) {
      return NextResponse.json({ error: 'connectionId is required' }, { status: 400 })
    }

    // Fetch the existing connection to verify ownership and get vault info
    const existing = await convex.query<{
      userId: string
      vaultObjectId?: string
      providerId: string
      endpoint: string
      displayName?: string
      isDefault: boolean
    } | null>(
      'providers/connections:getByServer',
      { serverSecret, connectionId },
      { throwOnError: true },
    )

    if (!existing) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    // Verify the connection belongs to the authenticated user
    if (existing.userId !== auth.userId) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    const endpointResolution = resolveByokEndpointForPatch(
      existing.providerId,
      endpoint,
      { isDefault: existing.isDefault },
    )
    if (!endpointResolution.ok) {
      return NextResponse.json(
        { error: endpointResolution.error },
        { status: endpointResolution.status },
      )
    }

    // Validate endpoint if it's being updated
    if (endpointResolution.endpoint !== undefined) {
      const urlError = await validateEndpointUrl(endpointResolution.endpoint)
      if (urlError) {
        return NextResponse.json({ error: urlError }, { status: 400 })
      }
    }

    const safeDisplayName = displayName === undefined ? undefined : normalizedDisplayName(displayName)
    if (safeDisplayName === null) {
      return NextResponse.json({ error: 'Invalid displayName' }, { status: 400 })
    }
    const safeApiKey = normalizedApiKey(apiKey)
    if (safeApiKey === null || (existing.isDefault && safeApiKey)) {
      return NextResponse.json({ error: 'Invalid API key update' }, { status: 400 })
    }
    const safeEnabledModelIds = normalizedModelIds(enabledModelIds)
    if (safeEnabledModelIds === null) {
      return NextResponse.json({ error: 'Invalid enabledModelIds' }, { status: 400 })
    }
    const safeDiscoveredModelsJson = normalizedDiscoveryJson(discoveredModelsJson)
    if (safeDiscoveredModelsJson === null) {
      return NextResponse.json({ error: 'Invalid discoveredModelsJson' }, { status: 400 })
    }
    if (status !== undefined && status !== 'active' && status !== 'error' && status !== 'untested') {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    if (lastError !== undefined && (typeof lastError !== 'string' || lastError.length > MAX_LAST_ERROR_LENGTH)) {
      return NextResponse.json({ error: 'Invalid lastError' }, { status: 400 })
    }
    if (lastTestedAt !== undefined && (typeof lastTestedAt !== 'number' || !Number.isFinite(lastTestedAt))) {
      return NextResponse.json({ error: 'Invalid lastTestedAt' }, { status: 400 })
    }
    if (discoveredAt !== undefined && (typeof discoveredAt !== 'number' || !Number.isFinite(discoveredAt))) {
      return NextResponse.json({ error: 'Invalid discoveredAt' }, { status: 400 })
    }

    const endpointChanged = endpointResolution.endpoint !== undefined &&
      normalizeByokEndpoint(endpointResolution.endpoint) !== normalizeByokEndpoint(existing.endpoint)
    const hasFreshEndpointTest = endpointChanged &&
      status === 'active' &&
      lastTestedAt !== undefined &&
      safeDiscoveredModelsJson !== undefined
    const effectiveStatus = endpointChanged && !hasFreshEndpointTest ? 'untested' : status
    const effectiveEnabledModelIds = endpointChanged && !hasFreshEndpointTest
      ? []
      : safeEnabledModelIds

    // Rotate only after every metadata field has passed validation.
    let vaultObjectId: string | undefined
    if (safeApiKey) {
      if (existing.vaultObjectId) {
        await updateByokVaultKey(existing.vaultObjectId, safeApiKey)
        vaultObjectId = existing.vaultObjectId
      } else {
        const vaultKeyName = byokVaultKeyName(auth.userId, connectionId)
        vaultObjectId = await writeByokVaultKey(
          vaultKeyName,
          safeApiKey,
          buildVaultContext(auth.userId, existing.providerId, connectionId),
        )
        newlyCreatedVaultObjectId = vaultObjectId
      }
    }

    await convex.mutation(
      'providers/connections:updateByServer',
      {
        serverSecret,
        connectionId,
        ...(safeDisplayName !== undefined ? { displayName: safeDisplayName } : {}),
        ...(endpointResolution.endpoint !== undefined ? { endpoint: endpointResolution.endpoint } : {}),
        ...(vaultObjectId !== undefined ? { vaultObjectId } : {}),
        ...(effectiveEnabledModelIds !== undefined ? { enabledModelIds: effectiveEnabledModelIds } : {}),
        ...(safeDiscoveredModelsJson !== undefined ? { discoveredModelsJson: safeDiscoveredModelsJson } : {}),
        ...(discoveredAt !== undefined ? { discoveredAt } : {}),
        ...(effectiveStatus !== undefined ? { status: effectiveStatus } : {}),
        ...(lastError !== undefined ? { lastError } : {}),
        ...(lastTestedAt !== undefined ? { lastTestedAt } : {}),
      },
      { throwOnError: true },
    )

    newlyCreatedVaultObjectId = undefined
    return NextResponse.json({ success: true })
  } catch (error) {
    if (newlyCreatedVaultObjectId) await deleteByokVaultKey(newlyCreatedVaultObjectId)
    logger.error('[BYOK] Failed to update provider connection', summarizeErrorForLog(error))
    return NextResponse.json({ error: 'Failed to update provider connection' }, { status: 500 })
  }
}

// DELETE /api/v1/providers/connections?connectionId=... — delete a connection
export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const connectionId = request.nextUrl.searchParams.get('connectionId')
    if (!connectionId || !CONNECTION_ID_PATTERN.test(connectionId)) {
      return NextResponse.json({ error: 'connectionId is required' }, { status: 400 })
    }

    // Fetch the connection to get the vault object ID for cleanup
    const existing = await convex.query<{
      userId: string
      vaultObjectId?: string
      isDeletable: boolean
    } | null>(
      'providers/connections:getByServer',
      { serverSecret, connectionId },
      { throwOnError: true },
    )

    if (!existing) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    // Verify the connection belongs to the authenticated user
    if (existing.userId !== auth.userId) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    if (!existing.isDeletable) {
      return NextResponse.json(
        { error: 'This connection cannot be deleted (it is the default provider)' },
        { status: 403 },
      )
    }

    // Remove authorization metadata first. Vault cleanup is best-effort after
    // the connection is no longer reachable by runtime model routing.
    await convex.mutation(
      'providers/connections:deleteByServer',
      { serverSecret, connectionId },
      { throwOnError: true },
    )
    if (existing.vaultObjectId) {
      await deleteByokVaultKey(existing.vaultObjectId)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[BYOK] Failed to delete provider connection', summarizeErrorForLog(error))
    return NextResponse.json({ error: 'Failed to delete provider connection' }, { status: 500 })
  }
}
