import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  durableJobs,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  knowledgeSources,
  knowledgeSourceVersions,
} from '@/server/database/postgres/schema'
import { durableJobAuthorization } from '@/server/jobs/DurableJobAuthorization'
import { chunkKnowledgeText } from '@/shared/knowledge/chunking'
import type { EmbeddingProvider } from '@/server/knowledge/EmbeddingProvider'
import type {
  CanonicalKnowledgeIndexQueue,
  CanonicalKnowledgeIndexRequest,
} from './KnowledgeSourceIngestionService'

export const CANONICAL_KNOWLEDGE_INDEX_JOB = 'knowledge.index-canonical-source'

export class PostgresCanonicalKnowledgeIndexQueue implements CanonicalKnowledgeIndexQueue {
  constructor(private readonly db: OverlayPostgresDb) {}

  async enqueue(request: CanonicalKnowledgeIndexRequest): Promise<string> {
    const id = randomUUID()
    const dedupeKey = createHash('sha256')
      .update(`canonical:${request.sourceId}:${request.contentHash}:${request.sourceVersionId}`)
      .digest('hex')
    const [inserted] = await this.db.insert(durableJobs).values({
      dedupeKey,
      id,
      maxAttempts: 5,
      payload: {
        ...request,
        ...durableJobAuthorization(request.userId, ['knowledge.edit']),
      },
      priority: 20,
      type: CANONICAL_KNOWLEDGE_INDEX_JOB,
    }).onConflictDoNothing().returning({ id: durableJobs.id })
    if (inserted) return inserted.id
    const [existing] = await this.db.select({ id: durableJobs.id }).from(durableJobs)
      .where(eq(durableJobs.dedupeKey, dedupeKey)).limit(1)
    if (!existing) throw new Error('Canonical knowledge index dedupe conflict could not be resolved')
    return existing.id
  }

  async purge(request: { sourceId: string; userId: string }): Promise<void> {
    await this.db.delete(knowledgeChunks).where(and(
      eq(knowledgeChunks.knowledgeSourceId, request.sourceId),
      eq(knowledgeChunks.userId, request.userId),
    ))
  }
}

export class PostgresCanonicalKnowledgeIndexService {
  constructor(private readonly deps: { db: OverlayPostgresDb; embeddings: EmbeddingProvider }) {}

  async index(request: CanonicalKnowledgeIndexRequest): Promise<{ chunks: number; skipped?: 'deleted' | 'stale' }> {
    const [source] = await this.deps.db.select().from(knowledgeSources).where(and(
      eq(knowledgeSources.id, request.sourceId),
      eq(knowledgeSources.ownerUserId, request.userId),
    )).limit(1)
    const [version] = await this.deps.db.select().from(knowledgeSourceVersions).where(and(
      eq(knowledgeSourceVersions.id, request.sourceVersionId),
      eq(knowledgeSourceVersions.sourceId, request.sourceId),
    )).limit(1)
    if (!source || source.deletedAt || !version) return { chunks: 0, skipped: 'deleted' }
    if (source.contentHash !== request.contentHash || version.contentHash !== request.contentHash) {
      return { chunks: 0, skipped: 'stale' }
    }
    const content = typeof version.metadata.content === 'string'
      ? version.metadata.content.trim()
      : typeof source.metadata.content === 'string' ? source.metadata.content.trim() : ''
    if (!content) return await this.fail(request, 'Extracted source content is unavailable')
    const segments = chunkKnowledgeText(content)
    try {
      const vectors = await this.deps.embeddings.embed(segments.map(({ text }) => text))
      await this.deps.db.transaction(async (tx) => {
        await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.knowledgeSourceId, source.id))
        const now = new Date()
        for (let index = 0; index < segments.length; index += 1) {
          const segment = segments[index]!
          const chunkId = `chunk_${randomUUID()}`
          const contentHash = createHash('sha256').update(segment.text).digest('hex')
          await tx.insert(knowledgeChunks).values({
            chunkIndex: segment.chunkIndex,
            contentHash,
            id: chunkId,
            knowledgeSourceId: source.id,
            knowledgeSourceVersionId: version.id,
            sourceId: source.id,
            sourceKind: source.kind === 'memory' ? 'memory' : 'file',
            startOffset: segment.startOffset,
            text: segment.text,
            title: source.title,
            userId: source.ownerUserId,
          })
          await tx.insert(knowledgeChunkEmbeddings).values({
            chunkId,
            contentHash,
            dimensions: this.deps.embeddings.identity.dimensions,
            embedding: vectors[index]!,
            modelId: this.deps.embeddings.identity.modelId,
            modelVersion: this.deps.embeddings.identity.modelVersion,
            provider: this.deps.embeddings.identity.provider,
            sourceKind: source.kind === 'memory' ? 'memory' : 'file',
            userId: source.ownerUserId,
          })
        }
        await tx.update(knowledgeSourceVersions).set({
          status: 'ready',
          metadata: sql`${knowledgeSourceVersions.metadata} || ${JSON.stringify({
            chunks: segments.length,
            embeddingModelVersion: this.deps.embeddings.identity.modelVersion,
          })}::jsonb`,
          updatedAt: now,
        }).where(eq(knowledgeSourceVersions.id, version.id))
        await tx.update(knowledgeSources).set({ status: 'ready', statusMessage: null, updatedAt: now })
          .where(eq(knowledgeSources.id, source.id))
      })
      return { chunks: segments.length }
    } catch (error) {
      return await this.fail(request, error instanceof Error ? error.message : String(error), error)
    }
  }

  private async fail(
    request: CanonicalKnowledgeIndexRequest,
    message: string,
    cause?: unknown,
  ): Promise<never> {
    const clipped = message.slice(0, 2_000)
    await Promise.all([
      this.deps.db.update(knowledgeSources).set({ status: 'failed', statusMessage: clipped, updatedAt: new Date() })
        .where(eq(knowledgeSources.id, request.sourceId)),
      this.deps.db.update(knowledgeSourceVersions).set({ status: 'failed', updatedAt: new Date() })
        .where(eq(knowledgeSourceVersions.id, request.sourceVersionId)),
    ])
    throw cause instanceof Error ? cause : new Error(clipped)
  }
}
