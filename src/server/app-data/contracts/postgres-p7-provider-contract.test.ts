import 'server-only'

import test from 'node:test'
import { eq } from 'drizzle-orm'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import { PostgresAdministrativeRepository, PostgresAuditRepository } from '@/server/admin'
import { PostgresApiKeyRepository } from '@/server/auth/api-keys'
import { PostgresBillingProviderEventRepository, PostgresBillingRepository } from '@/server/billing/PostgresBillingRepository'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'
import { PostgresProjectRepository } from '@/server/projects/PostgresProjectRepository'
import { PostgresUsageRepository } from '@/server/usage/PostgresUsageRepository'
import { runP7ProviderContract } from './p7-provider-contract'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('real Postgres P7 provider contract', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    max: 24,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const billing = new PostgresBillingRepository(db)
  try {
    await runP7ProviderContract(t, {
      administration: new PostgresAdministrativeRepository(db),
      apiKeys: new PostgresApiKeyRepository(db),
      audit: new PostgresAuditRepository(db),
      billing,
      billingEvents: new PostgresBillingProviderEventRepository(db),
      cleanupUser: async (userId) => { await db.delete(users).where(eq(users.id, userId)) },
      deleteUser: async (userId) => { await new PostgresAccountDataDeletionRepository(db).deleteUserAccount({ userId }) },
      prepareUser: async (userId) => {
        await db.insert(users).values({ email: `${userId}@example.test`, id: userId }).onConflictDoNothing()
      },
      projects: new PostgresProjectRepository(db),
      provider: 'postgres',
      usage: new PostgresUsageRepository(db),
    })
  } finally {
    await pool.end()
  }
})
