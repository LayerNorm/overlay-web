import 'server-only'

import { logger } from '@/server/observability/logger'

/**
 * Server-side helpers for writing, reading, and deleting BYOK (bring-your-own-key)
 * API keys in WorkOS Vault. These functions are used by the BFF routes that handle
 * provider connection create/update/delete — the Vault object ID is stored in the
 * Convex `userProviderConnections` table for future reference.
 *
 * Vault key naming convention: `byok_{userId}_{connectionId}`
 */

export type ByokVaultKeyContext = {
  /** `agent-provider-account` is a coding-agent credential (Claude Code, Codex), not a model-routing key; `agent-secret` is a value an agent's imported config asked for (an MCP server's token). */
  purpose: 'byok-provider-key' | 'agent-provider-account' | 'agent-secret' | 'subscription-credential'
  userId: string
  providerId: string
  connectionId?: string
}

type VaultObjectMetadata = {
  id?: unknown
}

type VaultObject = VaultObjectMetadata & {
  value?: unknown
}

type VaultFailureCode = 'missing_configuration' | 'http_failure' | 'invalid_context' | 'invalid_response'

type VaultUpstreamFailureDetails = {
  upstreamCode?: string
  upstreamFields?: string[]
}

class VaultFailure extends Error {
  constructor(
    readonly code: VaultFailureCode,
    readonly httpStatus?: number,
    readonly upstreamCode?: string,
    readonly upstreamFields?: string[],
    readonly invalidContextKeys?: string[],
  ) {
    super(`WorkOS Vault ${code}`)
  }
}

type VaultFailureLogContext = {
  code: string
  httpStatus?: number
  upstreamCode?: string
  upstreamFields?: string[]
  invalidContextKeys?: string[]
}

function vaultFailureContext(error: unknown): VaultFailureLogContext {
  if (!(error instanceof VaultFailure)) return { code: 'transport_failure' }

  return {
    code: error.code,
    ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
    ...(error.upstreamCode === undefined ? {} : { upstreamCode: error.upstreamCode }),
    ...(error.upstreamFields === undefined ? {} : { upstreamFields: error.upstreamFields }),
    ...(error.invalidContextKeys === undefined ? {} : { invalidContextKeys: error.invalidContextKeys }),
  }
}

const UPSTREAM_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/i
const UPSTREAM_FIELD_PATTERN = /^[a-z][a-z0-9_.\[\]-]{0,63}$/i
const VAULT_CONTEXT_VALUE_PATTERN = /^[A-Za-z0-9/_-]{1,500}$/
const MAX_VAULT_CONTEXT_ENTRIES = 10
const MAX_DIAGNOSTIC_CONTEXT_KEYS = 5

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function getVaultUpstreamFailureDetails(payload: unknown): VaultUpstreamFailureDetails {
  if (!isPlainObject(payload)) return {}

  const upstreamCode =
    typeof payload.code === 'string' && UPSTREAM_CODE_PATTERN.test(payload.code)
      ? payload.code
      : typeof payload.error === 'string' && UPSTREAM_CODE_PATTERN.test(payload.error)
        ? payload.error
        : undefined

  const upstreamFields: string[] = []
  const seenFields = new Set<string>()
  if (Array.isArray(payload.errors)) {
    for (const error of payload.errors) {
      if (!isPlainObject(error)) continue
      const field = error.field
      if (typeof field !== 'string' || !UPSTREAM_FIELD_PATTERN.test(field) || seenFields.has(field)) continue
      seenFields.add(field)
      upstreamFields.push(field)
      if (upstreamFields.length === 5) break
    }
  } else if (isPlainObject(payload.errors)) {
    for (const field of Object.keys(payload.errors)) {
      if (!UPSTREAM_FIELD_PATTERN.test(field) || seenFields.has(field)) continue
      seenFields.add(field)
      upstreamFields.push(field)
      if (upstreamFields.length === 5) break
    }
  }

  return {
    ...(upstreamCode === undefined ? {} : { upstreamCode }),
    ...(upstreamFields.length === 0 ? {} : { upstreamFields }),
  }
}

function getInvalidVaultContextKeys(context: ByokVaultKeyContext): string[] | undefined {
  if (!isPlainObject(context)) return ['context']

  const entries = Object.entries(context)
  const invalidKeys = entries.flatMap(([key, value], index) =>
    typeof value !== 'string' ||
    !VAULT_CONTEXT_VALUE_PATTERN.test(value) ||
    (entries.length > MAX_VAULT_CONTEXT_ENTRIES && index >= MAX_VAULT_CONTEXT_ENTRIES)
      ? [key]
      : [],
  )
  if (invalidKeys.length === 0) return undefined

  const safeKeys = [...new Set(invalidKeys.filter((key) => UPSTREAM_FIELD_PATTERN.test(key)))]
    .slice(0, MAX_DIAGNOSTIC_CONTEXT_KEYS)
  return safeKeys.length > 0 ? safeKeys : ['context']
}

function getWorkOSApiKey(): string {
  const apiKey = process.env.WORKOS_API_KEY?.trim()
  if (!apiKey) {
    throw new VaultFailure('missing_configuration')
  }
  return apiKey
}

function getWorkOSBaseUrl(): string {
  return (process.env.WORKOS_API_BASE_URL?.trim() || 'https://api.workos.com').replace(/\/$/, '')
}

async function vaultRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<T | null> {
  const response = await fetch(`${getWorkOSBaseUrl()}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${getWorkOSApiKey()}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })

  if (response.status === 204) return null

  // The body must be read before it can be parsed — nothing else can run
  // concurrently, so the await is inherent.
  // react-doctor-disable-next-line react-doctor/async-defer-await
  const text = await response.text()
  const payload = text
    ? (() => {
        try {
          return JSON.parse(text) as unknown
        } catch (_error) {
          return text
        }
      })()
    : null

  if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
    const upstreamFailureDetails = getVaultUpstreamFailureDetails(payload)
    throw new VaultFailure(
      'http_failure',
      response.status,
      upstreamFailureDetails.upstreamCode,
      upstreamFailureDetails.upstreamFields,
    )
  }

  return payload as T
}

function getVaultObjectId(payload: VaultObjectMetadata | null): string {
  if (payload && typeof payload.id === 'string' && payload.id.trim()) return payload.id
  throw new VaultFailure('invalid_response')
}

/**
 * Creates a new Vault object storing the user's API key for a BYOK connection.
 * Returns the Vault object ID (stored in userProviderConnections.vaultObjectId).
 */
export async function writeByokVaultKey(
  vaultKeyName: string,
  apiKey: string,
  context: ByokVaultKeyContext,
): Promise<string> {
  try {
    const invalidContextKeys = getInvalidVaultContextKeys(context)
    if (invalidContextKeys) {
      throw new VaultFailure('invalid_context', undefined, undefined, undefined, invalidContextKeys)
    }

    const result = await vaultRequest<VaultObjectMetadata>('POST', '/vault/v1/kv', {
      name: vaultKeyName,
      value: apiKey,
      key_context: context,
    })
    const vaultObjectId = getVaultObjectId(result)
    logger.info('[BYOK Vault] Created vault object')
    return vaultObjectId
  } catch (error) {
    logger.error('[BYOK Vault] Failed to create vault object', vaultFailureContext(error))
    throw new Error('Failed to store API key in vault')
  }
}

/**
 * Updates the value of an existing Vault object (key rotation).
 * Requires the vault object ID from the connection record.
 */
export async function updateByokVaultKey(
  vaultObjectId: string,
  apiKey: string,
): Promise<void> {
  try {
    await vaultRequest<VaultObject>('PUT', `/vault/v1/kv/${encodeURIComponent(vaultObjectId)}`, {
      value: apiKey,
    })
    logger.info('[BYOK Vault] Updated vault object')
  } catch (error) {
    logger.error('[BYOK Vault] Failed to update vault object', vaultFailureContext(error))
    throw new Error('Failed to rotate API key in vault')
  }
}

/**
 * Deletes a Vault object, removing the user's API key from the vault.
 * Called when a BYOK connection is deleted.
 */
export async function deleteByokVaultKey(vaultObjectId: string): Promise<void> {
  try {
    await vaultRequest<null>('DELETE', `/vault/v1/kv/${encodeURIComponent(vaultObjectId)}`)
    logger.info('[BYOK Vault] Deleted vault object')
  } catch (error) {
    logger.error('[BYOK Vault] Failed to delete vault object', vaultFailureContext(error))
    throw new Error('Failed to delete vault object')
  }
}

/**
 * Reads a BYOK API key from the vault by its object ID.
 * Used by the runtime model resolver to fetch the user's key when routing
 * a request to a BYOK provider.
 *
 * Returns null if the vault object doesn't exist or can't be read (e.g.
 * WORKOS_API_KEY not configured, object was deleted out-of-band).
 */
export async function readByokVaultKey(vaultObjectId: string): Promise<string | null> {
  const apiKey = process.env.WORKOS_API_KEY?.trim()
  if (!apiKey) return null

  try {
    const obj = await vaultRequest<VaultObject>(
      'GET',
      `/vault/v1/kv/${encodeURIComponent(vaultObjectId)}`,
    )
    const val = typeof obj?.value === 'string' ? obj.value.trim() : ''
    return val.length > 0 ? val : null
  } catch (error) {
    logger.warn('[BYOK Vault] Failed to read vault object', vaultFailureContext(error))
    return null
  }
}

/**
 * Generates the vault key name for a BYOK connection.
 * Convention: `byok_{userId}_{connectionId}`
 */
export function byokVaultKeyName(userId: string, connectionId: string): string {
  return `byok_${userId}_${connectionId}`
}
