import 'server-only'

import type { McpAccessLevel } from '@/shared/mcp/access'

export type McpGrantRecord = {
  id: string
  userId: string
  workspaceId: string
  access: McpAccessLevel
  kind: 'oauth' | 'token'
  clientName: string
  clientId?: string
  refreshVersion: number
  createdAt: number
  lastUsedAt?: number
  expiresAt?: number
  revokedAt?: number
}

export interface McpGrantRepository {
  get(args: { grantId: string }): Promise<McpGrantRecord | null>
  listActive(args: { userId: string }): Promise<McpGrantRecord[]>
  create(args: {
    userId: string; workspaceId: string; access: McpAccessLevel; kind: 'oauth' | 'token'; clientName: string
    clientId?: string; codeId?: string; expiresAt?: number; maxActive: number; now: number
  }): Promise<{ ok: boolean; reason?: string; id?: string }>
  touch(args: { grantId: string; now: number }): Promise<void>
  rotateRefresh(args: { grantId: string; presentedVersion: number; now: number }): Promise<{ ok: boolean; version?: number; reason?: string }>
  revoke(args: { grantId: string; userId: string; now: number }): Promise<boolean>
  deleteAllForUser(args: { userId: string }): Promise<number>
}
