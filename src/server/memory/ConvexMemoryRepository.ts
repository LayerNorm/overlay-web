import 'server-only'

import type { Id } from '../../../convex/_generated/dataModel'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { MemoryRecord, MemoryRepository, MemoryWrite } from './MemoryRepository'

export class ConvexMemoryRepository implements MemoryRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async get(args: { includeDeleted?: boolean; memoryId: string; userId: string; workspaceId?: string }): Promise<MemoryRecord | null> {
    const rows = await convex.query<MemoryRecord[]>('knowledge/memories:getByIds', {
      userId: args.userId,
      memoryIds: [args.memoryId as Id<'memories'>],
      serverSecret: this.serverSecret,
      includeDeleted: true,
    }) ?? []
    const memory = rows[0] ?? null
    if (!memory || (args.workspaceId !== undefined && memory.workspaceId !== args.workspaceId)) return null
    return args.includeDeleted || !memory.deletedAt ? memory : null
  }

  async list(args: {
    conversationId?: string
    creatorUserId?: string
    includeDeleted?: boolean
    noteId?: string
    scope?: 'owner' | 'workspace'
    updatedSince?: number
    userId: string
    workspaceId?: string
  }): Promise<MemoryRecord[]> {
    if (args.scope === 'workspace') {
      if (!args.workspaceId) throw new Error('workspaceId required for workspace memory listing')
      const { scope: _scope, userId: _actorUserId, ...queryArgs } = args
      return await convex.query<MemoryRecord[]>('knowledge/memories:listWorkspace', {
        ...queryArgs,
        serverSecret: this.serverSecret,
      }) ?? []
    }
    const { creatorUserId: _creatorUserId, scope: _scope, ...queryArgs } = args
    return await convex.query<MemoryRecord[]>('knowledge/memories:list', {
      ...queryArgs,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async create(args: MemoryWrite): Promise<MemoryRecord> {
    const memoryId = await convex.mutation<string>('knowledge/memories:add', {
      ...args,
      serverSecret: this.serverSecret,
    })
    if (!memoryId) throw new Error('Failed to create memory')
    const memory = await this.get({ includeDeleted: true, memoryId, userId: args.userId, workspaceId: args.workspaceId })
    if (!memory) throw new Error('Created memory could not be loaded')
    return memory
  }

  async update(args: Omit<MemoryWrite, 'clientId' | 'userId'> & {
    memoryId: string
    userId: string
    workspaceId?: string
  }): Promise<MemoryRecord | null> {
    await convex.mutation('knowledge/memories:update', {
      ...args,
      memoryId: args.memoryId as Id<'memories'>,
      serverSecret: this.serverSecret,
    })
    return await this.get({ includeDeleted: true, memoryId: args.memoryId, userId: args.userId, workspaceId: args.workspaceId })
  }

  async remove(args: { memoryId: string; userId: string; workspaceId?: string }): Promise<{ deletedAt: number; memoryId: string } | null> {
    const existing = await this.get({ memoryId: args.memoryId, userId: args.userId, workspaceId: args.workspaceId })
    if (!existing) return null
    await convex.mutation('knowledge/memories:remove', {
      memoryId: args.memoryId as Id<'memories'>,
      serverSecret: this.serverSecret,
      userId: args.userId,
      workspaceId: args.workspaceId,
    })
    return { deletedAt: Date.now(), memoryId: args.memoryId }
  }

  async touch(args: { memoryId: string; userId: string; workspaceId?: string }): Promise<void> {
    await convex.mutation('knowledge/memories:touch', {
      memoryId: args.memoryId as Id<'memories'>,
      serverSecret: this.serverSecret,
      userId: args.userId,
      workspaceId: args.workspaceId,
    })
  }
}
