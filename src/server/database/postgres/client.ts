import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool, type PoolConfig } from 'pg'
import { logger } from '@/server/observability/logger'

import * as schema from './schema'

export interface CreateOverlayPostgresPoolOptions {
  connectionString: string
  max?: number
  sslMode?: string
}

export function createOverlayPostgresPool(options: CreateOverlayPostgresPoolOptions): Pool {
  const poolConfig: PoolConfig = {
    connectionString: options.connectionString,
    max: options.max ?? 10,
  }

  if (options.sslMode && options.sslMode !== 'disable') {
    poolConfig.ssl = options.sslMode === 'verify-full'
      ? true
      : { rejectUnauthorized: false }
  }

  const pool = new Pool(poolConfig)
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
