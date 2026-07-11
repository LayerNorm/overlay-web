import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { durableJobs } from '@/server/database/postgres/schema'

export const KNOWLEDGE_REINDEX_JOB = 'knowledge.reindex-source'

type Transaction = Parameters<Parameters<OverlayPostgresDb['transaction']>[0]>[0]
type JobDb = OverlayPostgresDb | Transaction

export async function enqueueKnowledgeReindexJob(db: JobDb, args: {
  contentHash: string
  sourceId: string
  sourceKind: 'file' | 'memory'
  userId: string
}): Promise<string> {
  const modelVersion = process.env.OVERLAY_EMBEDDING_MODEL_VERSION?.trim() || 'text-embedding-3-small-v1'
  const dedupeKey = `knowledge:${args.sourceKind}:${args.sourceId}:${args.contentHash}:${modelVersion}`
  const id = randomUUID()
  const inserted = await db
    .insert(durableJobs)
    .values({
      dedupeKey: createHash('sha256').update(dedupeKey).digest('hex'),
      id,
      maxAttempts: 5,
      payload: { ...args, modelVersion },
      priority: 20,
      type: KNOWLEDGE_REINDEX_JOB,
    })
    .onConflictDoNothing()
    .returning({ id: durableJobs.id })
  return inserted[0]?.id ?? id
}
