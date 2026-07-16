import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  files,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  memories,
} from '@/server/database/postgres/schema'
import type { EmbeddingModelIdentity } from './EmbeddingProvider'

export type KnowledgeIndexSource = {
  content: string
  contentHash: string
  projectId?: string
  sourceId: string
  sourceKind: 'file' | 'memory'
  title?: string
  userId: string
}

export type KnowledgeIndexedChunk = {
  chunkIndex: number
  contentHash: string
  embedding: number[]
  startOffset: number
  text: string
}

export class PostgresKnowledgeIndexRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async getSource(args: {
    sourceId: string
    sourceKind: 'file' | 'memory'
    userId: string
  }): Promise<KnowledgeIndexSource | null> {
    if (args.sourceKind === 'file') {
      const [row] = await this.db
        .select({
          content: files.textContent,
          fallbackContent: files.content,
          contentHash: files.contentHash,
          duplicateOfFileId: files.duplicateOfFileId,
          id: files.id,
          indexable: files.indexable,
          name: files.name,
          projectId: files.projectId,
          userId: files.userId,
        })
        .from(files)
        .where(and(
          eq(files.id, args.sourceId),
          eq(files.userId, args.userId),
          isNull(files.deletedAt),
        ))
        .limit(1)
      const content = row?.content ?? row?.fallbackContent ?? ''
      if (!row || !row.indexable || row.duplicateOfFileId || !row.contentHash || !content.trim()) return null
      return {
        content,
        contentHash: row.contentHash,
        projectId: row.projectId ?? undefined,
        sourceId: row.id,
        sourceKind: 'file',
        title: row.name,
        userId: row.userId,
      }
    }

    const [row] = await this.db
      .select()
      .from(memories)
      .where(and(
        eq(memories.id, args.sourceId),
        eq(memories.userId, args.userId),
        isNull(memories.deletedAt),
      ))
      .limit(1)
    if (!row) return null
    return {
      content: row.content,
      contentHash: row.contentHash,
      projectId: row.projectId ?? undefined,
      sourceId: row.id,
      sourceKind: 'memory',
      title: 'Memory',
      userId: row.userId,
    }
  }

  async replaceSource(args: {
    chunks: KnowledgeIndexedChunk[]
    identity: EmbeddingModelIdentity
    source: KnowledgeIndexSource
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(knowledgeChunks).where(and(
        eq(knowledgeChunks.sourceKind, args.source.sourceKind),
        eq(knowledgeChunks.sourceId, args.source.sourceId),
        eq(knowledgeChunks.userId, args.source.userId),
      ))
      const now = new Date()
      for (const chunk of args.chunks) {
        const chunkId = `chunk_${randomUUID()}`
        await tx.insert(knowledgeChunks).values({
          chunkIndex: chunk.chunkIndex,
          contentHash: chunk.contentHash,
          createdAt: now,
          id: chunkId,
          projectId: args.source.projectId,
          sourceId: args.source.sourceId,
          sourceKind: args.source.sourceKind,
          startOffset: chunk.startOffset,
          text: chunk.text,
          title: args.source.title,
          updatedAt: now,
          userId: args.source.userId,
        })
        await tx.insert(knowledgeChunkEmbeddings).values({
          chunkId,
          contentHash: chunk.contentHash,
          createdAt: now,
          dimensions: args.identity.dimensions,
          embedding: chunk.embedding,
          modelId: args.identity.modelId,
          modelVersion: args.identity.modelVersion,
          provider: args.identity.provider,
          sourceKind: args.source.sourceKind,
          updatedAt: now,
          userId: args.source.userId,
        })
      }
      await markSource(tx, args.source, {
        embeddingModelVersion: args.identity.modelVersion,
        indexError: null,
        indexedAt: now,
        indexStatus: args.chunks.length > 0 ? 'indexed' : 'skipped',
      })
    })
  }

  async markFailed(source: KnowledgeIndexSource, error: string): Promise<void> {
    await markSource(this.db, source, {
      indexError: error.slice(0, 2_000),
      indexStatus: 'failed',
    })
  }

  async purgeSource(args: {
    sourceId: string
    sourceKind: 'file' | 'memory'
    userId: string
  }): Promise<void> {
    await this.db.delete(knowledgeChunks).where(and(
      eq(knowledgeChunks.sourceKind, args.sourceKind),
      eq(knowledgeChunks.sourceId, args.sourceId),
      eq(knowledgeChunks.userId, args.userId),
    ))
  }
}

type SourcePatch = {
  embeddingModelVersion?: string
  indexError?: string | null
  indexedAt?: Date
  indexStatus: 'pending' | 'indexed' | 'skipped' | 'failed'
}
type Transaction = Parameters<Parameters<OverlayPostgresDb['transaction']>[0]>[0]
type IndexDb = OverlayPostgresDb | Transaction

async function markSource(db: IndexDb, source: KnowledgeIndexSource, patch: SourcePatch): Promise<void> {
  if (source.sourceKind === 'file') {
    await db.update(files).set({
      embeddingModelVersion: patch.embeddingModelVersion,
      indexError: patch.indexError,
      indexedAt: patch.indexedAt,
      indexStatus: patch.indexStatus,
      updatedAt: new Date(),
    }).where(and(eq(files.id, source.sourceId), eq(files.userId, source.userId)))
    return
  }
  await db.update(memories).set({
    embeddingModelVersion: patch.embeddingModelVersion,
    indexError: patch.indexError,
    indexedAt: patch.indexedAt,
    indexStatus: patch.indexStatus,
    updatedAt: new Date(),
  }).where(and(eq(memories.id, source.sourceId), eq(memories.userId, source.userId)))
}
