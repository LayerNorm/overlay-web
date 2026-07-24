import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq } from 'drizzle-orm'
import { ApiKeyService } from '@/server/auth/api-keys/ApiKeyService'
import { PostgresApiKeyRepository } from '@/server/auth/api-keys/PostgresApiKeyRepository'
import {
  PostgresBillingProviderEventRepository,
  PostgresBillingRepository,
} from '@/server/billing/PostgresBillingRepository'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'
import { PostgresUsageRepository } from '@/server/usage/PostgresUsageRepository'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres P7 replacement and recovery faults', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    max: 8,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const scope = `p7_fault_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`

  try {
    await db.insert(users).values({ email: `${scope}@example.test`, id: userId })
    const billing = new PostgresBillingRepository(db)
    await billing.upsertSubscription({ planKind: 'paid', status: 'active', tier: 'pro', userId })
    await billing.recordBudgetTopUp({
      amountCents: 500,
      source: 'manual',
      status: 'succeeded',
      stripePaymentIntentId: `${scope}_payment`,
      userId,
    })

    await t.test('a discarded database connection is replaced before the next reservation', async () => {
      const failed = await pool.connect()
      const failedPid = Number((await failed.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid)
      failed.release(new Error('simulated RDS connection loss'))
      const recovered = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      assert.notEqual(Number(recovered.rows[0]?.pid), failedPid)

      const usage = new PostgresUsageRepository(db)
      const entitlements = await usage.getEntitlements({ userId })
      assert.ok(entitlements)
      const reservationId = `${scope}_after_reconnect`
      assert.equal((await usage.reserve({
        entitlements: entitlements!,
        kind: 'ask',
        operationId: 'fault.reconnect',
        requestFingerprint: reservationId,
        reservationId,
        reservedCents: 10,
        userId,
      })).ok, true)
      assert.equal((await usage.finalize({ actualCostCents: 8, reservationId, userId })).status, 'finalized')
      assert.equal((await usage.finalize({ actualCostCents: 8, reservationId, userId })).status, 'finalized')
    })

    await t.test('replacement web tasks share API-key revocation state', async () => {
      const firstTask = new ApiKeyService(new PostgresApiKeyRepository(db))
      const replacementTask = new ApiKeyService(new PostgresApiKeyRepository(db))
      const created = await firstTask.create({ createdBy: userId, scopes: ['chat:read'], userId })
      assert.ok(await replacementTask.validate({ apiKey: created.key, requiredScopes: ['chat:read'] }))
      assert.equal(await firstTask.revokeById({ id: created.id, userId }), true)
      assert.equal(await replacementTask.validate({ apiKey: created.key }), null)
    })

    await t.test('failed provider event is reacquired and processed state is terminal', async () => {
      const events = new PostgresBillingProviderEventRepository(db)
      const event = {
        eventId: `${scope}_retry_event`,
        eventType: 'invoice.paid',
        payloadHash: 'stable-payload',
        provider: 'stripe',
      }
      assert.deepEqual(await events.reserve(event), { status: 'acquired', attempt: 1 })
      await events.markFailed({ error: 'simulated worker death', eventId: event.eventId, provider: event.provider })
      assert.deepEqual(await events.reserve(event), { status: 'acquired', attempt: 2 })
      await events.markProcessed({ eventId: event.eventId, provider: event.provider })
      assert.deepEqual(await events.reserve(event), { status: 'duplicate', processed: true })
    })
  } finally {
    await db.delete(users).where(eq(users.id, userId))
    await pool.end()
  }
})
