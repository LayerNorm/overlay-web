import 'server-only'

import { sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'

export type PostgresRuntimeHealth = {
  deadLetterCount: number
  oldestQueuedJobAgeSeconds: number
  queuedCount: number
  runningCount: number
}

export class PostgresRuntimeHealthService {
  constructor(private readonly db: OverlayPostgresDb) {}

  async read(now = Date.now()): Promise<PostgresRuntimeHealth> {
    const result = await this.db.execute<{
      dead_letter_count: number
      oldest_queued_job_age_seconds: number
      queued_count: number
      running_count: number
    }>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'queued')::int AS queued_count,
        count(*) FILTER (WHERE status = 'running')::int AS running_count,
        count(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter_count,
        COALESCE(
          EXTRACT(EPOCH FROM (${new Date(now)} - min(available_at) FILTER (WHERE status = 'queued'))),
          0
        )::int AS oldest_queued_job_age_seconds
      FROM durable_jobs
    `)
    const row = result.rows[0]
    return {
      deadLetterCount: Number(row?.dead_letter_count ?? 0),
      oldestQueuedJobAgeSeconds: Math.max(0, Number(row?.oldest_queued_job_age_seconds ?? 0)),
      queuedCount: Number(row?.queued_count ?? 0),
      runningCount: Number(row?.running_count ?? 0),
    }
  }
}
