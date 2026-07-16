import 'server-only'

import type { Id } from '../../../convex/_generated/dataModel'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { MemoryRecord, MemoryRepository, MemoryWrite } from './MemoryRepository'

export class ConvexMemoryRepository implements MemoryRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async get(args: { includeDeleted?: boolean; memoryId: string; userId: string }): Promise<MemoryRecord | null> {
    const rows = await this.list({ includeDeleted: true, userId: args.userId })
    const memory = rows.find((row) => row._id === args.memoryId) ?? null
    return memory && (args.includeDeleted || !memory.deletedAt) ? memory : null
  }

  async list(args: {
    conversationId?: string
    includeDeleted?: boolean
    noteId?: string
    projectId?: string
    updatedSince?: number
    userId: string
  }): Promise<MemoryRecord[]> {
    return await convex.query<MemoryRecord[]>('knowledge/memories:list', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async create(args: MemoryWrite): Promise<MemoryRecord> {
    const memoryId = await convex.mutation<string>('knowledge/memories:add', {
      ...args,
      serverSecret: this.serverSecret,
    })
    if (!memoryId) throw new Error('Failed to create memory')
    const memory = await this.get({ includeDeleted: true, memoryId, userId: args.userId })
    if (!memory) throw new Error('Created memory could not be loaded')
    return memory
  }

  async update(args: Omit<MemoryWrite, 'clientId' | 'userId'> & {
    memoryId: string
    userId: string
  }): Promise<MemoryRecord | null> {
    await convex.mutation('knowledge/memories:update', {
      ...args,
      memoryId: args.memoryId as Id<'memories'>,
      serverSecret: this.serverSecret,
    })
    return await this.get({ includeDeleted: true, memoryId: args.memoryId, userId: args.userId })
  }

  async remove(args: { memoryId: string; userId: string }): Promise<{ deletedAt: number; memoryId: string } | null> {
    const existing = await this.get({ memoryId: args.memoryId, userId: args.userId })
    if (!existing) return null
    await convex.mutation('knowledge/memories:remove', {
      memoryId: args.memoryId as Id<'memories'>,
      serverSecret: this.serverSecret,
      userId: args.userId,
    })
    return { deletedAt: Date.now(), memoryId: args.memoryId }
  }
}
