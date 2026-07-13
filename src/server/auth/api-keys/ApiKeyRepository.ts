import 'server-only'

import type { ApiKeyScope } from '@/shared/auth/api-key-scopes'

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

export interface ApiKeyRepository {
  create(args: Omit<ApiKeyRecord, 'id'> & { keyHash: string }): Promise<ApiKeyRecord>
  listByUser(args: { userId: string }): Promise<ApiKeyRecord[]>
  validateAndTouch(args: {
    keyHash: string
    lastUsedAt: number
    lastUsedIp?: string
    now: number
  }): Promise<ApiKeyRecord | null>
  revokeByHash(args: {
    keyHash: string
    revokedAt: number
    revokedReason?: string
    userId?: string
  }): Promise<boolean>
  revokeById(args: {
    id: string
    revokedAt: number
    revokedReason?: string
    userId: string
  }): Promise<boolean>
  rotateById(args: {
    id: string
    keyHash: string
    name?: string
    userId: string
    scopes: ApiKeyScope[]
    expiresAt: number
    createdAt: number
    createdBy?: string
    createdFromIp?: string
    revokedReason: string
  }): Promise<ApiKeyRecord | null>
}
