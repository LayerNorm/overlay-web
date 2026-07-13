import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { sql } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'
import {
  PostgresBillingProviderEventRepository,
  PostgresBillingRepository,
} from '@/server/billing/PostgresBillingRepository'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres billing records and provider events are idempotent and isolated', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres billing contracts',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const scope = `p7d_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`
  const otherUserId = `${scope}_other`
  const billing = new PostgresBillingRepository(db)
  const events = new PostgresBillingProviderEventRepository(db)

  try {
    await db.insert(users).values([
      { id: userId, email: `${scope}@example.com`, emailVerified: true, name: 'Billing User' },
      { id: otherUserId, email: `${scope}-other@example.com`, emailVerified: true, name: 'Other User' },
    ])
    await billing.upsertSubscription({
      userId,
      email: `${scope}@example.com`,
      stripeCustomerId: `${scope}_customer`,
      stripeSubscriptionId: `${scope}_subscription`,
      stripePriceId: `${scope}_price`,
      stripeQuantity: 25,
      tier: 'pro',
      planKind: 'paid',
      planAmountCents: 2500,
      status: 'active',
      currentPeriodStart: Date.now(),
      currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })
    const subscription = await billing.getSubscriptionByUserIdByServer({ userId })
    assert.equal(subscription?.stripeCustomerId, `${scope}_customer`)
    assert.equal(subscription?.planAmountCents, 2500)
    await assert.rejects(
      billing.upsertSubscription({
        userId: otherUserId,
        stripeCustomerId: `${scope}_customer`,
        tier: 'pro',
        planKind: 'paid',
        status: 'active',
      }),
      /already belongs to another user/,
    )

    const topUp = {
      amountCents: 500,
      source: 'manual' as const,
      status: 'succeeded' as const,
      stripeCheckoutSessionId: `${scope}_checkout`,
      stripePaymentIntentId: `${scope}_payment`,
      userId,
    }
    assert.equal((await billing.recordBudgetTopUp(topUp)).granted, true)
    assert.equal((await billing.recordBudgetTopUp(topUp)).granted, false)
    const entitlements = await billing.getEntitlementsByServer({ userId })
    assert.equal(entitlements?.budgetTotalCents, 500)
    assert.equal((await billing.listBudgetTopUpsByServer({ userId })).length, 1)

    const reservation = {
      eventId: `${scope}_event`,
      eventType: 'checkout.session.completed',
      payloadHash: 'payload-hash',
      provider: 'stripe',
    }
    assert.deepEqual(await events.reserve(reservation), { status: 'acquired', attempt: 1 })
    await events.markProcessed({ eventId: reservation.eventId, provider: 'stripe' })
    assert.deepEqual(await events.reserve(reservation), { status: 'duplicate', processed: true })
    await assert.rejects(events.reserve({ ...reservation, payloadHash: 'different' }), /hash mismatch/)
  } finally {
    await db.execute(sql`DELETE FROM users WHERE id IN (${userId}, ${otherUserId})`)
    await db.execute(sql`DELETE FROM billing_provider_events WHERE event_id LIKE ${`${scope}%`}`)
    await pool.end()
  }
})
