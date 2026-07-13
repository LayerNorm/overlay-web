import 'server-only'

import {
  hasRequiredApiKeyScopes,
  normalizeApiKeyScopes,
  type ApiKeyScope,
} from '@/shared/auth/api-key-scopes'
import { generateApiKey, hashApiKey, isApiKeyCandidate } from './crypto'
import type { ApiKeyRecord, ApiKeyRepository } from './ApiKeyRepository'

const API_KEY_DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000
const API_KEY_MAX_TTL_MS = 180 * 24 * 60 * 60 * 1000
const API_KEY_ADMIN_MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NEGATIVE_CACHE_TTL_MS = 60_000
const NEGATIVE_CACHE_MAX_SIZE = 5_000

export type { ApiKeyRecord } from './ApiKeyRepository'
export type CreatedApiKey = ApiKeyRecord & { key: string }

export class ApiKeyService {
  private readonly negativeValidationCache = new Map<string, number>()

  constructor(private readonly repository: ApiKeyRepository) {}

  async list(args: { userId: string }): Promise<ApiKeyRecord[]> {
    return await this.repository.listByUser({ userId: assertUserId(args.userId) })
  }

  async create(args: {
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
    assertAdminScopeAllowed({ allowAdminScope: args.allowAdminScope, createdBy, scopes })
    const record = await this.repository.create({
      keyHash: hashApiKey(key),
      name: normalizeOptionalText(args.name, 120),
      userId: assertUserId(args.userId),
      scopes,
      expiresAt: resolveExpiresAt({ expiresAt: args.expiresAt, now, scopes }),
      createdAt: now,
      createdBy,
      createdFromIp: normalizeOptionalText(args.createdFromIp, 128),
    })
    return { ...record, key }
  }

  async validate(args: {
    apiKey: string
    clientIp?: string
    requiredScopes?: readonly ApiKeyScope[]
  }): Promise<ApiKeyRecord | null> {
    if (!isApiKeyCandidate(args.apiKey)) return null
    const now = Date.now()
    const keyHash = hashApiKey(args.apiKey)
    this.cleanupNegativeCache(now)
    if (this.hasNegativeCacheHit(keyHash, now)) return null
    const record = await this.repository.validateAndTouch({
      keyHash,
      lastUsedAt: now,
      lastUsedIp: normalizeOptionalText(args.clientIp, 128),
      now,
    })
    if (!record) {
      this.negativeValidationCache.set(keyHash, now + NEGATIVE_CACHE_TTL_MS)
      return null
    }
    if (!hasRequiredApiKeyScopes(record.scopes, args.requiredScopes)) return null
    return record
  }

  async revoke(args: {
    apiKey: string
    revokedReason?: string
    userId?: string
  }): Promise<boolean> {
    if (!isApiKeyCandidate(args.apiKey)) return false
    const keyHash = hashApiKey(args.apiKey)
    const revoked = await this.repository.revokeByHash({
      keyHash,
      revokedAt: Date.now(),
      revokedReason: normalizeOptionalText(args.revokedReason, 200),
      userId: args.userId ? assertUserId(args.userId) : undefined,
    })
    if (revoked) this.negativeValidationCache.set(keyHash, Date.now() + NEGATIVE_CACHE_TTL_MS)
    return revoked
  }

  async revokeById(args: { id: string; revokedReason?: string; userId: string }): Promise<boolean> {
    return await this.repository.revokeById({
      id: requiredText(args.id, 'id'),
      revokedAt: Date.now(),
      revokedReason: normalizeOptionalText(args.revokedReason, 200),
      userId: assertUserId(args.userId),
    })
  }

  async rotateById(args: {
    allowAdminScope?: boolean
    createdBy?: string
    createdFromIp?: string
    expiresAt?: number
    id: string
    name?: string
    revokedReason?: string
    scopes: readonly unknown[]
    userId: string
  }): Promise<CreatedApiKey | null> {
    const now = Date.now()
    const key = generateApiKey()
    const scopes = normalizeCreateScopes(args.scopes)
    const createdBy = normalizeOptionalText(args.createdBy, 128)
    assertAdminScopeAllowed({ allowAdminScope: args.allowAdminScope, createdBy, scopes })
    const record = await this.repository.rotateById({
      id: requiredText(args.id, 'id'),
      keyHash: hashApiKey(key),
      name: normalizeOptionalText(args.name, 120),
      userId: assertUserId(args.userId),
      scopes,
      expiresAt: resolveExpiresAt({ expiresAt: args.expiresAt, now, scopes }),
      createdAt: now,
      createdBy,
      createdFromIp: normalizeOptionalText(args.createdFromIp, 128),
      revokedReason: normalizeOptionalText(args.revokedReason, 200) ?? 'rotated',
    })
    return record ? { ...record, key } : null
  }

  private cleanupNegativeCache(now: number): void {
    for (const [keyHash, expiresAt] of this.negativeValidationCache.entries()) {
      if (expiresAt <= now) this.negativeValidationCache.delete(keyHash)
    }
    while (this.negativeValidationCache.size > NEGATIVE_CACHE_MAX_SIZE) {
      const first = this.negativeValidationCache.keys().next().value
      if (!first) break
      this.negativeValidationCache.delete(first)
    }
  }

  private hasNegativeCacheHit(keyHash: string, now: number): boolean {
    const expiresAt = this.negativeValidationCache.get(keyHash)
    if (!expiresAt) return false
    if (expiresAt <= now) {
      this.negativeValidationCache.delete(keyHash)
      return false
    }
    return true
  }
}

function assertUserId(userId: string): string {
  return requiredText(userId, 'userId')
}

function requiredText(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

function normalizeOptionalText(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, maxLength)
}

function resolveExpiresAt(args: {
  expiresAt: number | undefined
  now: number
  scopes: readonly ApiKeyScope[]
}): number {
  const includesAdmin = args.scopes.includes('admin')
  const maxTtlMs = includesAdmin ? API_KEY_ADMIN_MAX_TTL_MS : API_KEY_MAX_TTL_MS
  const resolved = args.expiresAt ?? args.now + Math.min(API_KEY_DEFAULT_TTL_MS, maxTtlMs)
  if (!Number.isFinite(resolved) || resolved <= args.now) throw new Error('expiresAt must be a future timestamp')
  if (resolved > args.now + maxTtlMs) {
    throw new Error(`expiresAt exceeds maximum API key TTL of ${Math.floor(maxTtlMs / 86_400_000)} days`)
  }
  return resolved
}

function normalizeCreateScopes(scopes: readonly unknown[]): ApiKeyScope[] {
  const normalized = normalizeApiKeyScopes(scopes)
  if (normalized.length === 0) throw new Error('At least one API key scope is required')
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
