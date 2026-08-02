import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { durableJobs } from '@/server/database/postgres/schema'
import { durableJobAuthorization } from '@/server/jobs/DurableJobAuthorization'

export const MEMORY_EXTRACT_TURN_JOB = 'memory.extract-turn'

type Transaction = Parameters<Parameters<OverlayPostgresDb['transaction']>[0]>[0]
type JobDb = OverlayPostgresDb | Transaction

export async function enqueueMemoryExtractionJob(db: JobDb, args: {
  conversationId: string
  messageId: string
  turnId: string
  userId: string
}): Promise<string> {
  const id = randomUUID()
  const dedupeKey = createHash('sha256')
    .update(`memory-extract:${args.userId}:${args.conversationId}:${args.turnId}`)
    .digest('hex')
  const inserted = await db.insert(durableJobs).values({
    dedupeKey,
    id,
    maxAttempts: 5,
    payload: {
      ...args,
      ...durableJobAuthorization(args.userId, ['memory.use']),
    },
    priority: 10,
    type: MEMORY_EXTRACT_TURN_JOB,
  }).onConflictDoNothing().returning({ id: durableJobs.id })
  if (inserted[0]) return inserted[0].id
  const [existing] = await db.select({ id: durableJobs.id }).from(durableJobs)
    .where(eq(durableJobs.dedupeKey, dedupeKey))
    .limit(1)
  if (!existing) throw new Error('Memory extraction job dedupe conflict could not be resolved')
  return existing.id
}
