import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { ApiKeyRecord, ApiKeyRepository } from './ApiKeyRepository'

export class ConvexApiKeyRepository implements ApiKeyRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async create(args: Omit<ApiKeyRecord, 'id'> & { keyHash: string }): Promise<ApiKeyRecord> {
    const record = await convex.mutation<ApiKeyRecord>('auth/apiKeys:createByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!record) throw new Error('Failed to create API key')
    return record
  }

  async listByUser(args: { userId: string }): Promise<ApiKeyRecord[]> {
    return await convex.query<ApiKeyRecord[]>('auth/apiKeys:listByUserByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async validateAndTouch(args: {
    keyHash: string
    lastUsedAt: number
    lastUsedIp?: string
    now: number
  }): Promise<ApiKeyRecord | null> {
    return await convex.mutation<ApiKeyRecord | null>('auth/apiKeys:validateByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true, timeoutMs: 10_000 })
  }

  async revokeByHash(args: {
    keyHash: string
    revokedAt: number
    revokedReason?: string
    userId?: string
  }): Promise<boolean> {
    const result = await convex.mutation<{ revoked: boolean }>('auth/apiKeys:revokeByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    return result?.revoked === true
  }

  async revokeById(args: {
    id: string
    revokedAt: number
    revokedReason?: string
    userId: string
  }): Promise<boolean> {
    const result = await convex.mutation<{ revoked: boolean }>('auth/apiKeys:revokeByIdByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    return result?.revoked === true
  }

  async rotateById(args: {
    id: string
    keyHash: string
    name?: string
    userId: string
    scopes: ApiKeyRecord['scopes']
    expiresAt: number
    createdAt: number
    createdBy?: string
    createdFromIp?: string
    revokedReason: string
  }): Promise<ApiKeyRecord | null> {
    return await convex.mutation<ApiKeyRecord | null>('auth/apiKeys:rotateByIdByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }
}
