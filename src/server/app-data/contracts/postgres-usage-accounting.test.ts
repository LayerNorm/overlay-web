import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { sql } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'
import { PostgresUsageRepository } from '@/server/usage'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres usage accounting is atomic, idempotent, and recoverable', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres usage contracts',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const scope = `p7_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`
  const repository = new PostgresUsageRepository(db)

  try {
    await db.insert(users).values({
      email: `${scope}@example.com`,
      emailVerified: true,
      id: userId,
      name: 'P7 Contract User',
    })
    const unlimited = await repository.getEntitlements({ userId })
    assert.equal(unlimited?.planKind, 'paid')
    assert.ok((unlimited?.budgetRemainingCents ?? 0) > 1_000_000)

    await db.execute(sql`
      UPDATE usage_budget_accounts
      SET mode = 'budgeted', included_micros = 1000000,
          granted_micros = 0, used_micros = 0, reserved_micros = 0
      WHERE user_id = ${userId}
    `)
    const entitlements = await repository.getEntitlements({ userId })
    assert.equal(entitlements?.budgetTotalCents, 100)

    await t.test('concurrent reservations cannot overspend one budget', async () => {
      const attempts = await Promise.all([
        repository.reserve({
          entitlements: entitlements!,
          kind: 'agent',
          reservationId: `${scope}_concurrent_1`,
          reservedCents: 75,
          userId,
        }),
        repository.reserve({
          entitlements: entitlements!,
          kind: 'agent',
          reservationId: `${scope}_concurrent_2`,
          reservedCents: 75,
          userId,
        }),
      ])
      assert.equal(attempts.filter((result) => result.ok).length, 1)
      assert.equal(attempts.filter((result) => !result.ok).length, 1)
      const accepted = attempts.find((result) => result.ok)
      assert.ok(accepted?.reservationId)
      await repository.release({
        reservationId: accepted!.reservationId!,
        userId,
      })
    })

    await t.test('reserve and finalize are idempotent', async () => {
      const reservationId = `${scope}_finalize`
      const reserveArgs = {
        entitlements: entitlements!,
        kind: 'agent' as const,
        reservationId,
        reservedCents: 40,
        userId,
      }
      assert.equal((await repository.reserve(reserveArgs)).ok, true)
      assert.equal((await repository.reserve(reserveArgs)).ok, true)
      const finalizeArgs = {
        actualCostCents: 25,
        events: [{
          costCents: 25,
          inputTokens: 100,
          kind: 'agent' as const,
          modelId: 'contract/model',
          occurredAt: Date.now(),
          outputTokens: 20,
          providerCostUsd: 0.2,
        }],
        reservationId,
        userId,
      }
      assert.equal((await repository.finalize(finalizeArgs)).status, 'finalized')
      assert.equal((await repository.finalize(finalizeArgs)).status, 'finalized')
      const counts = await db.execute<{ events: number; usedMicros: number | string }>(sql`
        SELECT
          (SELECT count(*)::int FROM usage_events WHERE reservation_id = ${reservationId}) AS events,
          used_micros AS "usedMicros"
        FROM usage_budget_accounts WHERE user_id = ${userId}
      `)
      assert.equal(Number(counts.rows[0]?.events), 1)
      assert.equal(Number(counts.rows[0]?.usedMicros), 250000)
    })

    await t.test('standalone usage events deduplicate by operation and index', async () => {
      const args = {
        events: [{
          costCents: 5,
          kind: 'embedding' as const,
          occurredAt: Date.now(),
          providerCostUsd: 0.04,
        }],
        operationId: `${scope}_batch`,
        userId,
      }
      assert.deepEqual(await repository.recordBatch(args), { recorded: 1 })
      assert.deepEqual(await repository.recordBatch(args), { recorded: 0 })
    })

    await t.test('expired reservations release capacity or require reconciliation', async () => {
      const now = Date.now()
      await repository.reserve({
        entitlements: (await repository.getEntitlements({ userId }))!,
        expiresAt: now - 1,
        kind: 'sandbox',
        reservationId: `${scope}_expired_release`,
        reservedCents: 10,
        userId,
      })
      await repository.reserve({
        entitlements: (await repository.getEntitlements({ userId }))!,
        expiresAt: now - 1,
        kind: 'sandbox',
        reservationId: `${scope}_expired_reconcile`,
        reservedCents: 10,
        userId,
      })
      await repository.markForReconcile({
        errorMessage: 'provider_started',
        reservationId: `${scope}_expired_reconcile`,
        userId,
      })
      const result = await repository.reconcileExpired({ now })
      assert.equal(result.released, 1)
      const statuses = await db.execute<{ id: string; status: string }>(sql`
        SELECT id, status FROM usage_reservations
        WHERE id IN (${`${scope}_expired_release`}, ${`${scope}_expired_reconcile`})
      `)
      assert.equal(statuses.rows.find((row) => row.id.endsWith('expired_release'))?.status, 'expired')
      assert.equal(statuses.rows.find((row) => row.id.endsWith('expired_reconcile'))?.status, 'reconcile_required')
    })
  } finally {
    await db.execute(sql`DELETE FROM users WHERE id = ${userId}`)
    await pool.end()
  }
})

