import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool, type PoolConfig } from 'pg'
import { logger } from '@/server/observability/logger'
import { capturePostgresQueryMetric } from '@/server/observability/metrics'

import * as schema from './schema'

export interface CreateOverlayPostgresPoolOptions {
  connectionTimeoutMs?: number
  connectionString: string
  max?: number
  sslMode?: string
}

export function createOverlayPostgresPool(options: CreateOverlayPostgresPoolOptions): Pool {
  const poolConfig: PoolConfig = {
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 10_000,
    connectionString: options.connectionString,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    max: options.max ?? 10,
  }

  if (options.sslMode && options.sslMode !== 'disable') {
    poolConfig.ssl = true
  }

  const pool = new Pool(poolConfig)
  pool.on('connect', (client) => {
    // Wrap the client query method to capture per-query timing metrics.
    // We use `any` casts because the `pg` query method has complex overloads
    // (callback, promise, stream) that are difficult to type generically.
    const originalQuery = client.query.bind(client) as unknown as (...args: unknown[]) => unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instrumented = function instrumentedQuery(...args: any[]) {
      const startTime = performance.now()
      const result = originalQuery(...args)
      // Only instrument promise-returning calls (not callback or stream calls).
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        ;(result as Promise<{ rowCount?: number } | Array<{ rowCount?: number }>>)
          .then((res) => {
            const rows = Array.isArray(res)
              ? res.reduce((sum, r) => sum + (r.rowCount ?? 0), 0)
              : res?.rowCount ?? 0
            const durationMs = Math.round(performance.now() - startTime)
            // eslint-disable-next-line no-console
            console.log('[PG_METRIC]', JSON.stringify({ durationMs, rowsReturned: rows }))
            capturePostgresQueryMetric({
              operation: 'execute',
              durationMs,
              rowsReturned: rows,
            })
          })
          .catch((_error) => {
            const durationMs = Math.round(performance.now() - startTime)
            // eslint-disable-next-line no-console
            console.log('[PG_METRIC]', JSON.stringify({ durationMs, error: true }))
            capturePostgresQueryMetric({
              operation: 'execute',
              durationMs,
              retried: false,
            })
          })
      }
      return result
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(client as any).query = instrumented
    client.on('error', (error) => {
      logger.error('[Postgres] Client connection error', {
        code: typeof error === 'object' && error && 'code' in error ? error.code : undefined,
        error,
      })
    })
  })
  pool.on('error', (error) => {
    logger.error('[Postgres] Idle client error', {
      code: typeof error === 'object' && error && 'code' in error ? error.code : undefined,
      error,
    })
  })
  return pool
}

export function createOverlayPostgresDb(pool: Pool) {
  return drizzle(pool, { schema })
}

export type OverlayPostgresDb = ReturnType<typeof createOverlayPostgresDb>
