import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import {
  hasRequiredApiKeyScopes,
  normalizeApiKeyScopes,
  type ApiKeyScope,
} from '@/shared/auth/api-key-scopes'
import { generateApiKey, hashApiKey, isApiKeyCandidate } from './crypto'

const API_KEY_DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000
const API_KEY_MAX_TTL_MS = 180 * 24 * 60 * 60 * 1000
const API_KEY_ADMIN_MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NEGATIVE_CACHE_TTL_MS = 60_000
const NEGATIVE_CACHE_MAX_SIZE = 5_000

export type ApiKeyRecord = {
  id: string
  name?: string
  userId: string
  scopes: ApiKeyScope[]
  expiresAt: number
  createdAt: number
  createdBy?: string
  createdFromIp?: string
  lastUsedAt?: number
  lastUsedIp?: string
  revokedAt?: number
  revokedReason?: string
}

export type CreatedApiKey = ApiKeyRecord & {
  key: string
}

type ConvexApiKeyRecord = Omit<ApiKeyRecord, 'scopes'> & {
  scopes: ApiKeyScope[]
}

const negativeValidationCache = new Map<string, number>()

function assertUserId(userId: string): string {
  const trimmed = userId.trim()
  if (!trimmed) throw new Error('userId is required')
  return trimmed
}

function normalizeOptionalText(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed.length > maxLength) return trimmed.slice(0, maxLength)
  return trimmed
}

function resolveExpiresAt(args: {
  expiresAt: number | undefined
  now: number
  scopes: readonly ApiKeyScope[]
}): number {
  const includesAdmin = args.scopes.includes('admin')
  const maxTtlMs = includesAdmin ? API_KEY_ADMIN_MAX_TTL_MS : API_KEY_MAX_TTL_MS
  const defaultTtlMs = Math.min(API_KEY_DEFAULT_TTL_MS, maxTtlMs)
  const resolved = args.expiresAt ?? args.now + defaultTtlMs

  if (!Number.isFinite(resolved) || resolved <= args.now) {
    throw new Error('expiresAt must be a future timestamp')
  }
  if (resolved > args.now + maxTtlMs) {
    throw new Error(`expiresAt exceeds maximum API key TTL of ${Math.floor(maxTtlMs / 86_400_000)} days`)
  }
  return resolved
}

function normalizeCreateScopes(scopes: readonly unknown[]): ApiKeyScope[] {
  const normalized = normalizeApiKeyScopes(scopes)
  if (normalized.length === 0) {
    throw new Error('At least one API key scope is required')
  }
  return normalized
}

function assertAdminScopeAllowed(args: {
  allowAdminScope?: boolean
  createdBy?: string
  scopes: readonly ApiKeyScope[]
}): void {
  if (!args.scopes.includes('admin')) return
  if (!args.allowAdminScope || !args.createdBy?.trim()) {
    throw new Error('admin API key scope requires explicit elevated authorization')
  }
}

function cleanupNegativeCache(now: number): void {
  for (const [keyHash, expiresAt] of negativeValidationCache.entries()) {
    if (expiresAt <= now) negativeValidationCache.delete(keyHash)
  }
  while (negativeValidationCache.size > NEGATIVE_CACHE_MAX_SIZE) {
    const first = negativeValidationCache.keys().next().value
    if (!first) break
    negativeValidationCache.delete(first)
  }
}

function hasNegativeCacheHit(keyHash: string, now: number): boolean {
  const expiresAt = negativeValidationCache.get(keyHash)
  if (!expiresAt) return false
  if (expiresAt <= now) {
    negativeValidationCache.delete(keyHash)
    return false
  }
  return true
}

export class ApiKeyService {
  static async create(args: {
    allowAdminScope?: boolean
    createdBy?: string
    createdFromIp?: string
    name?: string
    userId: string
    scopes: readonly unknown[]
    expiresAt?: number
  }): Promise<CreatedApiKey> {
    const now = Date.now()
    const key = generateApiKey()
    const scopes = normalizeCreateScopes(args.scopes)
    const createdBy = normalizeOptionalText(args.createdBy, 128)
    assertAdminScopeAllowed({
      allowAdminScope: args.allowAdminScope,
      createdBy,
      scopes,
    })
    const record = await convex.mutation<ConvexApiKeyRecord>(
      'auth/apiKeys:createByServer',
      {
        serverSecret: getInternalApiSecret(),
        keyHash: hashApiKey(key),
        name: normalizeOptionalText(args.name, 120),
        userId: assertUserId(args.userId),
        scopes,
        expiresAt: resolveExpiresAt({ expiresAt: args.expiresAt, now, scopes }),
        createdAt: now,
        createdBy,
        createdFromIp: normalizeOptionalText(args.createdFromIp, 128),
      },
      { throwOnError: true },
    )
    if (!record) throw new Error('Failed to create API key')
    return { ...record, key }
  }

  static async validate(args: {
    apiKey: string
    clientIp?: string
    requiredScopes?: readonly ApiKeyScope[]
  }): Promise<ApiKeyRecord | null> {
    if (!isApiKeyCandidate(args.apiKey)) return null
    const now = Date.now()
    const keyHash = hashApiKey(args.apiKey)
    cleanupNegativeCache(now)
    if (hasNegativeCacheHit(keyHash, now)) return null

    const record = await convex.mutation<ConvexApiKeyRecord | null>(
      'auth/apiKeys:validateByServer',
      {
        serverSecret: getInternalApiSecret(),
        keyHash,
        lastUsedAt: now,
        lastUsedIp: normalizeOptionalText(args.clientIp, 128),
        now,
      },
      { throwOnError: true, timeoutMs: 10_000 },
    )
    if (!record) {
      negativeValidationCache.set(keyHash, now + NEGATIVE_CACHE_TTL_MS)
      return null
    }
    if (!hasRequiredApiKeyScopes(record.scopes, args.requiredScopes)) return null
    return record
  }

  static async revoke(args: {
    apiKey: string
    revokedReason?: string
    userId?: string
  }): Promise<boolean> {
    if (!isApiKeyCandidate(args.apiKey)) return false
    const keyHash = hashApiKey(args.apiKey)

    const result = await convex.mutation<{ revoked: boolean }>(
      'auth/apiKeys:revokeByServer',
      {
        serverSecret: getInternalApiSecret(),
        keyHash,
        revokedAt: Date.now(),
        revokedReason: normalizeOptionalText(args.revokedReason, 200),
        userId: args.userId ? assertUserId(args.userId) : undefined,
      },
      { throwOnError: true },
    )
    if (result?.revoked === true) {
      negativeValidationCache.set(keyHash, Date.now() + NEGATIVE_CACHE_TTL_MS)
    }
    return result?.revoked === true
  }

  static async rotate(args: {
    allowAdminScope?: boolean
    apiKey: string
    createdBy?: string
    createdFromIp?: string
    name?: string
    revokedReason?: string
    userId?: string
    scopes?: readonly unknown[]
    expiresAt?: number
  }): Promise<CreatedApiKey | null> {
    const current = await this.validate({ apiKey: args.apiKey })
    if (!current) return null
    if (args.userId && current.userId !== assertUserId(args.userId)) return null

    const now = Date.now()
    const key = generateApiKey()
    const scopes = args.scopes ? normalizeCreateScopes(args.scopes) : current.scopes
    const createdBy = normalizeOptionalText(args.createdBy, 128)
    assertAdminScopeAllowed({
      allowAdminScope: args.allowAdminScope,
      createdBy,
      scopes,
    })
    const record = await convex.mutation<ConvexApiKeyRecord | null>(
      'auth/apiKeys:rotateByServer',
      {
        serverSecret: getInternalApiSecret(),
        oldKeyHash: hashApiKey(args.apiKey),
        newKeyHash: hashApiKey(key),
        name: normalizeOptionalText(args.name, 120) ?? current.name,
        userId: current.userId,
        scopes,
        expiresAt: resolveExpiresAt({
          expiresAt: args.expiresAt ?? current.expiresAt,
          now,
          scopes,
        }),
        createdBy,
        createdFromIp: normalizeOptionalText(args.createdFromIp, 128),
        revokedAt: now,
        revokedReason: normalizeOptionalText(args.revokedReason, 200) ?? 'rotated',
        now,
      },
      { throwOnError: true },
    )
    return record ? { ...record, key } : null
  }
}
