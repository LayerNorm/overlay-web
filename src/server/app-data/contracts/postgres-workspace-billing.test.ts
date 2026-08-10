import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { sql } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'
import { PostgresBillingRepository } from '@/server/billing/PostgresBillingRepository'
import { PostgresUsageRepository } from '@/server/usage/PostgresUsageRepository'
import { PostgresWorkspaceRepository } from '@/server/workspaces/PostgresWorkspaceRepository'
import { WorkspaceService } from '@/server/workspaces/WorkspaceService'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('workspace reservations atomically enforce account and subject limits without personal fallback', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres workspace billing contracts',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const scope = `workspace_billing_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`
  const billing = new PostgresBillingRepository(db)
  const usage = new PostgresUsageRepository(db)
  const workspaces = new WorkspaceService(new PostgresWorkspaceRepository(db))
  let workspaceId: string | undefined

  try {
    await db.insert(users).values({
      id: userId,
      email: `${scope}@example.test`,
      emailVerified: true,
      name: 'Workspace Billing Owner',
    })
    const access = await workspaces.createOrganization({ actorUserId: userId, name: scope })
    workspaceId = access.workspace.id
    const account = await billing.ensureWorkspaceBillingAccount({
      primaryBillingContactUserId: userId,
      workspaceId,
    })
    await db.execute(sql`
      UPDATE billing_account_balances
      SET included_micros = 10000000, updated_at = now()
      WHERE billing_account_id = ${account.billingAccountId}
    `)
    const periodStart = Date.now() - 60_000
    const periodEnd = Date.now() + 60 * 60_000
    await billing.upsertBillingAccountSpendLimit({
      billingAccountId: account.billingAccountId,
      limitCents: 300,
      periodEnd,
      periodStart,
      subject: { id: userId, kind: 'member' },
    })
    const payer = {
      billingAccountId: account.billingAccountId,
      scope: 'workspace' as const,
      subject: { id: userId, kind: 'member' as const },
      workspaceId,
    }
    const attempts = await Promise.all(Array.from({ length: 5 }, async (_, index) => usage.reserveWorkspace({
      kind: 'agent',
      operationId: `${scope}_operation_${index}`,
      payer,
      requestFingerprint: `${scope}_fingerprint_${index}`,
      reservationId: `${scope}_reservation_${index}`,
      reservedCents: 100,
      userId,
    })))
    const accepted = attempts.filter((result) => result.ok)
    const declined = attempts.filter((result) => !result.ok)
    assert.equal(accepted.length, 3)
    assert.equal(declined.length, 2)
    assert.ok(declined.every((result) => !result.ok && result.code === 'spend_limit_exceeded'))

    const [finalized, releasedOne, releasedTwo] = accepted
    assert.ok(finalized?.ok && finalized.reservationId)
    assert.ok(releasedOne?.ok && releasedOne.reservationId)
    assert.ok(releasedTwo?.ok && releasedTwo.reservationId)
    await usage.finalize({
      actualCostCents: 80,
      reservationId: finalized.reservationId!,
      userId,
    })
    await usage.release({ reservationId: releasedOne.reservationId!, userId })
    await usage.release({ reservationId: releasedTwo.reservationId!, userId })

    const limit = await billing.getBillingAccountSpendLimitByServer({
      billingAccountId: account.billingAccountId,
      subject: { id: userId, kind: 'member' },
    })
    assert.equal(limit?.usedCents, 80)
    assert.equal(limit?.reservedCents, 0)
    await billing.upsertBillingAccountSpendLimit({
      billingAccountId: account.billingAccountId,
      limitCents: 50,
      periodEnd,
      periodStart,
      subject: { id: 'shared_agent', kind: 'programmatic' },
    })
    const programmaticPayer = {
      ...payer,
      subject: { id: 'shared_agent', kind: 'programmatic' as const },
    }
    const programmaticDecline = await usage.reserveWorkspace({
      kind: 'agent',
      operationId: `${scope}_programmatic_decline`,
      payer: programmaticPayer,
      requestFingerprint: `${scope}_programmatic_decline`,
      reservationId: `${scope}_programmatic_decline`,
      reservedCents: 60,
      userId,
    })
    assert.ok(!programmaticDecline.ok && programmaticDecline.code === 'spend_limit_exceeded')
    const programmaticAccepted = await usage.reserveWorkspace({
      kind: 'agent',
      operationId: `${scope}_programmatic_accepted`,
      payer: programmaticPayer,
      requestFingerprint: `${scope}_programmatic_accepted`,
      reservationId: `${scope}_programmatic_accepted`,
      reservedCents: 50,
      userId,
    })
    assert.ok(programmaticAccepted.ok && programmaticAccepted.reservationId)
    await usage.finalize({
      actualCostCents: 50,
      reservationId: programmaticAccepted.reservationId!,
      userId,
    })
    const programmaticLimit = await billing.getBillingAccountSpendLimitByServer({
      billingAccountId: account.billingAccountId,
      subject: { id: 'shared_agent', kind: 'programmatic' },
    })
    assert.equal(programmaticLimit?.usedCents, 50)
    assert.equal(programmaticLimit?.reservedCents, 0)
    assert.equal((await billing.getBillingAccountSpendLimitByServer({
      billingAccountId: account.billingAccountId,
      subject: { id: userId, kind: 'member' },
    }))?.usedCents, 80)
    const lifecyclePayer = {
      ...payer,
      subject: { id: 'shared_automation', kind: 'programmatic' as const },
    }
    const lifecycleReservation = await usage.reserveWorkspace({
      kind: 'agent',
      operationId: `${scope}_lifecycle`,
      payer: lifecyclePayer,
      requestFingerprint: `${scope}_lifecycle`,
      reservationId: `${scope}_lifecycle`,
      reservedCents: 10,
      userId,
    })
    assert.ok(lifecycleReservation.ok && lifecycleReservation.reservationId)
    await db.execute(sql`
      UPDATE billing_accounts SET status = 'suspended' WHERE id = ${account.billingAccountId}
    `)
    await usage.finalize({
      actualCostCents: 10,
      reservationId: lifecycleReservation.reservationId!,
      userId,
    })
    await assert.rejects(
      usage.reserveWorkspace({
        kind: 'agent',
        operationId: `${scope}_suspended`,
        payer: lifecyclePayer,
        requestFingerprint: `${scope}_suspended`,
        reservationId: `${scope}_suspended`,
        reservedCents: 1,
        userId,
      }),
      /workspace_billing_account_inactive/,
    )
    const balances = await db.execute<{ reservedMicros: number | string; usedMicros: number | string }>(sql`
      SELECT reserved_micros AS "reservedMicros", used_micros AS "usedMicros"
      FROM billing_account_balances WHERE billing_account_id = ${account.billingAccountId}
    `)
    assert.deepEqual(balances.rows.map((row) => ({
      reservedMicros: Number(row.reservedMicros),
      usedMicros: Number(row.usedMicros),
    })), [{ reservedMicros: 0, usedMicros: 1400000 }])
    assert.equal(await billing.getPersonalBillingAccountByUserIdByServer({ userId }), null)
  } finally {
    if (workspaceId) await db.execute(sql`DELETE FROM workspaces WHERE id = ${workspaceId}`)
    await db.execute(sql`DELETE FROM users WHERE id = ${userId}`)
    await pool.end()
  }
})
