import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool, type PoolConfig } from 'pg'

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

  return new Pool(poolConfig)
}

export function createOverlayPostgresDb(pool: Pool) {
  return drizzle(pool, { schema })
}

export type OverlayPostgresDb = ReturnType<typeof createOverlayPostgresDb>
