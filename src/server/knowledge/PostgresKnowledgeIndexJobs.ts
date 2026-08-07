import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { durableJobs } from '@/server/database/postgres/schema'

export const KNOWLEDGE_REINDEX_JOB = 'knowledge.reindex-source'

type Transaction = Parameters<Parameters<OverlayPostgresDb['transaction']>[0]>[0]
type JobDb = OverlayPostgresDb | Transaction

export async function enqueueKnowledgeReindexJob(db: JobDb, args: {
  contentHash: string
  modelVersion?: string
  sourceId: string
  sourceKind: 'file' | 'memory'
  userId: string
  reviveDeadLetter?: boolean
}): Promise<string> {
  const modelVersion = args.modelVersion ?? (
    process.env.OVERLAY_EMBEDDING_MODEL_VERSION?.trim() || 'text-embedding-3-small-v1'
  )
  const dedupeKey = `knowledge:${args.sourceKind}:${args.sourceId}:${args.contentHash}:${modelVersion}`
  const id = randomUUID()
  const hashedDedupeKey = createHash('sha256').update(dedupeKey).digest('hex')
  const inserted = await db
    .insert(durableJobs)
    .values({
      dedupeKey: hashedDedupeKey,
      id,
      maxAttempts: 5,
      payload: {
        contentHash: args.contentHash,
        modelVersion,
        sourceId: args.sourceId,
        sourceKind: args.sourceKind,
        userId: args.userId,
      },
      priority: 20,
      type: KNOWLEDGE_REINDEX_JOB,
    })
    .onConflictDoNothing()
    .returning({ id: durableJobs.id })
  if (inserted[0]) return inserted[0].id
  if (args.reviveDeadLetter) {
    const [revived] = await db.update(durableJobs).set({
      attempts: 0,
      availableAt: new Date(),
      deadLetteredAt: null,
      lastError: null,
      leaseExpiresAt: null,
      leaseOwner: null,
      status: 'queued',
      updatedAt: new Date(),
    }).where(and(
      eq(durableJobs.dedupeKey, hashedDedupeKey),
      eq(durableJobs.status, 'dead_letter'),
    )).returning({ id: durableJobs.id })
    if (revived) return revived.id
  }
  const [existing] = await db.select({ id: durableJobs.id }).from(durableJobs)
    .where(eq(durableJobs.dedupeKey, hashedDedupeKey))
    .limit(1)
  if (!existing) throw new Error('Knowledge reindex job dedupe conflict could not be resolved')
  return existing.id
}
