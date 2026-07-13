import 'server-only'

import assert from 'node:assert/strict'
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

    const orderingUserId = `p7_ordering_${Date.now()}`
    await db.insert(users).values({ email: `${orderingUserId}@example.test`, id: orderingUserId })
    try {
      const subscription = {
        planAmountCents: 2_000,
        planKind: 'paid',
        provider: 'stripe',
        status: 'active',
        stripeCustomerId: `cus_${orderingUserId}`,
        stripeSubscriptionId: `sub_${orderingUserId}`,
        tier: 'pro',
        userId: orderingUserId,
      } as const
      await billing.upsertSubscription({ ...subscription, providerEventCreatedAt: 2_000 })
      await billing.upsertSubscription({
        ...subscription,
        planKind: 'free',
        providerEventCreatedAt: 4_000,
        status: 'canceled',
        tier: 'free',
      })
      await billing.upsertSubscription({ ...subscription, providerEventCreatedAt: 3_000 })
      assert.equal((await billing.getSubscriptionByUserIdByServer({ userId: orderingUserId }))?.status, 'canceled')

      await billing.upsertSubscription({ ...subscription, providerEventCreatedAt: 5_000 })
      assert.equal((await billing.getSubscriptionByUserIdByServer({ userId: orderingUserId }))?.status, 'active')
    } finally {
      await db.delete(users).where(eq(users.id, orderingUserId))
    }
  } finally {
    await pool.end()
  }
})
