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
    const personalAccount = await billing.ensurePersonalBillingAccount({ userId })
    assert.equal((await billing.ensurePersonalBillingAccount({ userId })).billingAccountId, personalAccount.billingAccountId)
    const balance = await db.execute<{
      includedMicros: number | string
      mode: 'budgeted' | 'unlimited'
      reservedMicros: number | string
      topUpBalanceMicros: number | string
      usedMicros: number | string
    }>(sql`
      SELECT mode,
             included_micros AS "includedMicros",
             top_up_balance_micros AS "topUpBalanceMicros",
             used_micros AS "usedMicros",
             reserved_micros AS "reservedMicros"
      FROM billing_account_balances
      WHERE billing_account_id = ${personalAccount.billingAccountId}
    `)
    assert.deepEqual(balance.rows.map((row) => ({
      includedMicros: Number(row.includedMicros),
      mode: row.mode,
      reservedMicros: Number(row.reservedMicros),
      topUpBalanceMicros: Number(row.topUpBalanceMicros),
      usedMicros: Number(row.usedMicros),
    })), [{
      includedMicros: 0,
      mode: 'budgeted',
      reservedMicros: 0,
      topUpBalanceMicros: 0,
      usedMicros: 0,
    }])
    await assert.rejects(
      db.execute(sql`
        INSERT INTO billing_accounts (id, scope, pricing_version, markup_basis_points)
        VALUES (${`${scope}_invalid_owner`}, 'personal', 'markup_25_v1', 2500)
      `),
      (error: unknown) =>
        (error as { cause?: { constraint?: string } }).cause?.constraint ===
        'billing_accounts_owner_check',
    )
    await assert.rejects(
      db.execute(sql`
        INSERT INTO billing_accounts (id, scope, owner_user_id, pricing_version, markup_basis_points)
        VALUES (${`${scope}_invalid_price`}, 'personal', ${otherUserId}, 'future_price', 2500)
      `),
      (error: unknown) =>
        (error as { cause?: { constraint?: string } }).cause?.constraint ===
        'billing_accounts_pricing_version_check',
    )
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
    assert.equal(entitlements?.billingAccountId, undefined)
    assert.equal(entitlements?.allowanceTotalCents, 2_500)
    assert.equal(entitlements?.topUpBalanceCents, 500)
    assert.equal(entitlements?.budgetTotalCents, 3_000)
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
