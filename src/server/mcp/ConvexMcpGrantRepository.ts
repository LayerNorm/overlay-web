import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { McpGrantRecord, McpGrantRepository } from './McpGrantRepository'

const call = { throwOnError: true } as const

export class ConvexMcpGrantRepository implements McpGrantRepository {
  async get(args: { grantId: string }) {
    return await convex.query<McpGrantRecord | null>('mcp/grants:getByServer', { serverSecret: getInternalApiSecret(), ...args }, call)
  }

  async listActive(args: { userId: string }) {
    return (await convex.query<McpGrantRecord[]>('mcp/grants:listByUserByServer', { serverSecret: getInternalApiSecret(), ...args }, call)) ?? []
  }

  async create(args: Parameters<McpGrantRepository['create']>[0]) {
    const result = await convex.mutation<{ ok: boolean; reason?: string; id?: string }>(
      'mcp/grants:createByServer', { serverSecret: getInternalApiSecret(), ...args }, call,
    )
    return result ?? { ok: false, reason: 'unavailable' }
  }

  async touch(args: { grantId: string; now: number }) {
    await convex.mutation('mcp/grants:touchByServer', { serverSecret: getInternalApiSecret(), ...args }, call)
  }

  async rotateRefresh(args: { grantId: string; presentedVersion: number; now: number }) {
    return (await convex.mutation<{ ok: boolean; version?: number; reason?: string }>(
      'mcp/grants:rotateRefreshByServer', { serverSecret: getInternalApiSecret(), ...args }, call,
    )) ?? { ok: false, reason: 'unavailable' }
  }

  async revoke(args: { grantId: string; userId: string; now: number }) {
    return Boolean(await convex.mutation<boolean>('mcp/grants:revokeByServer', { serverSecret: getInternalApiSecret(), ...args }, call))
  }

  async deleteAllForUser(args: { userId: string }) {
    return (await convex.mutation<number>('mcp/grants:deleteAllByUserByServer', { serverSecret: getInternalApiSecret(), ...args }, call)) ?? 0
  }
}
