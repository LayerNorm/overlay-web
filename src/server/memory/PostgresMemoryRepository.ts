import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { knowledgeChunks, memories } from '@/server/database/postgres/schema'
import { assertActivePostgresProject } from '@/server/projects/PostgresProjectAccess'
import type { MemoryRecord, MemoryRepository, MemoryWrite } from './MemoryRepository'

export class PostgresMemoryRepository implements MemoryRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async get(args: { includeDeleted?: boolean; memoryId: string; userId: string }): Promise<MemoryRecord | null> {
    const [row] = await this.db
      .select()
      .from(memories)
      .where(and(
        eq(memories.id, args.memoryId),
        eq(memories.userId, args.userId),
        ...(args.includeDeleted ? [] : [isNull(memories.deletedAt)]),
      ))
      .limit(1)
    return row ? toMemoryRecord(row) : null
  }

  async list(args: {
    conversationId?: string
    includeDeleted?: boolean
    noteId?: string
    projectId?: string
    updatedSince?: number
    userId: string
  }): Promise<MemoryRecord[]> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(and(
        eq(memories.userId, args.userId),
        ...(args.includeDeleted ? [] : [isNull(memories.deletedAt)]),
        ...(args.updatedSince !== undefined ? [gt(memories.updatedAt, new Date(args.updatedSince))] : []),
        ...(args.projectId !== undefined ? [eq(memories.projectId, args.projectId)] : []),
        ...(args.conversationId !== undefined ? [eq(memories.conversationId, args.conversationId)] : []),
        ...(args.noteId !== undefined ? [eq(memories.noteId, args.noteId)] : []),
      ))
      .orderBy(desc(memories.updatedAt))
      .limit(100)
    return rows.map(toMemoryRecord)
  }

  async create(args: MemoryWrite): Promise<MemoryRecord> {
    const content = requireContent(args.content)
    const contentHash = hashMemoryContent(content)
    const clientId = args.clientId?.trim() || undefined
    const now = new Date()
    const id = `memory_${randomUUID()}`

    const row = await this.db.transaction(async (tx) => {
      await assertActivePostgresProject(tx, { projectId: args.projectId, userId: args.userId })
      const inserted = await tx
        .insert(memories)
        .values({
          actor: args.actor,
          clientId,
          content,
          contentHash,
          conversationId: args.conversationId,
          createdAt: now,
          id,
          importance: args.importance,
          indexStatus: 'pending',
          messageId: args.messageId,
          noteId: args.noteId,
          projectId: args.projectId,
          source: args.source,
          tags: args.tags ?? [],
          turnId: args.turnId,
          type: args.type,
          updatedAt: now,
          userId: args.userId,
        })
        .onConflictDoNothing()
        .returning()
      if (inserted[0]) return inserted[0]

      const [existing] = await tx
        .select()
        .from(memories)
        .where(and(
          eq(memories.userId, args.userId),
          isNull(memories.deletedAt),
          ...(clientId
            ? [eq(memories.clientId, clientId)]
            : [eq(memories.contentHash, contentHash)]),
        ))
        .limit(1)
      if (!existing) throw new Error('Memory dedupe conflict could not be resolved')
      const [refreshed] = await tx
        .update(memories)
        .set({ updatedAt: now })
        .where(eq(memories.id, existing.id))
        .returning()
      return refreshed ?? existing
    })

    return toMemoryRecord(row)
  }

  async update(args: Omit<MemoryWrite, 'clientId' | 'userId'> & {
    memoryId: string
    userId: string
  }): Promise<MemoryRecord | null> {
    const content = requireContent(args.content)
    const now = new Date()
    const [row] = await this.db.transaction(async (tx) => {
      await assertActivePostgresProject(tx, { projectId: args.projectId, userId: args.userId })
      await tx.delete(knowledgeChunks).where(and(
        eq(knowledgeChunks.sourceKind, 'memory'),
        eq(knowledgeChunks.sourceId, args.memoryId),
        eq(knowledgeChunks.userId, args.userId),
      ))
      return await tx
        .update(memories)
        .set({
          actor: args.actor,
          content,
          contentHash: hashMemoryContent(content),
          conversationId: args.conversationId,
          embeddingModelVersion: null,
          importance: args.importance,
          indexError: null,
          indexedAt: null,
          indexStatus: 'pending',
          messageId: args.messageId,
          noteId: args.noteId,
          projectId: args.projectId,
          source: args.source,
          tags: args.tags ?? [],
          turnId: args.turnId,
          type: args.type,
          updatedAt: now,
        })
        .where(and(
          eq(memories.id, args.memoryId),
          eq(memories.userId, args.userId),
          isNull(memories.deletedAt),
        ))
        .returning()
    })
    return row ? toMemoryRecord(row) : null
  }

  async remove(args: { memoryId: string; userId: string }): Promise<{ deletedAt: number; memoryId: string } | null> {
    const deletedAt = new Date()
    const [row] = await this.db.transaction(async (tx) => {
      await tx.delete(knowledgeChunks).where(and(
        eq(knowledgeChunks.sourceKind, 'memory'),
        eq(knowledgeChunks.sourceId, args.memoryId),
        eq(knowledgeChunks.userId, args.userId),
      ))
      return await tx
        .update(memories)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(and(
          eq(memories.id, args.memoryId),
          eq(memories.userId, args.userId),
          isNull(memories.deletedAt),
        ))
        .returning({ id: memories.id })
    })
    return row ? { deletedAt: deletedAt.getTime(), memoryId: row.id } : null
  }
}

type MemoryRow = typeof memories.$inferSelect

function toMemoryRecord(row: MemoryRow): MemoryRecord {
  return {
    _id: row.id,
    userId: row.userId,
    clientId: row.clientId ?? undefined,
    content: row.content,
    source: row.source,
    type: row.type ?? undefined,
    importance: row.importance ?? undefined,
    projectId: row.projectId ?? undefined,
    conversationId: row.conversationId ?? undefined,
    noteId: row.noteId ?? undefined,
    messageId: row.messageId ?? undefined,
    turnId: row.turnId ?? undefined,
    tags: row.tags ?? [],
    actor: row.actor ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    deletedAt: row.deletedAt?.getTime(),
  }
}

export function hashMemoryContent(content: string): string {
  return createHash('sha256')
    .update(content.toLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex')
}

function requireContent(content: string): string {
  const value = content.trim()
  if (!value) throw new Error('Memory content is required')
  if (Buffer.byteLength(value, 'utf8') > 50 * 1024) {
    throw new Error('Memory content exceeds size limit (max 50 KB)')
  }
  return value
}
