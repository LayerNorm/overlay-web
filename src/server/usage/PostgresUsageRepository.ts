import 'server-only'

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import type {
  UsageEvent,
  UsageRepository,
  UsageReservationResult,
  UsageReservationStatus,
} from './UsageRepository'

const MICROS_PER_CENT = 10_000
const DEFAULT_RESERVATION_TTL_MS = 30 * 60_000
const UNLIMITED_TOTAL_MICROS = Number.MAX_SAFE_INTEGER

type BudgetAccountRow = {
  grantedMicros: number | string
  includedMicros: number | string
  mode: 'unlimited' | 'budgeted'
  reservedMicros: number | string
  usedMicros: number | string
}

type ReservationRow = {
  actualMicros: number | string | null
  kind: string
  metadata: Record<string, unknown>
  modelId: string | null
  providerWorkStarted: boolean
  reservedMicros: number | string
  status: UsageReservationStatus
  userId: string
}

type Transaction = Parameters<Parameters<OverlayPostgresDb['transaction']>[0]>[0]

export class PostgresUsageRepository implements UsageRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async getEntitlements(args: { userId: string }): Promise<Entitlements | null> {
    return await this.db.transaction(async (tx) => {
      const account = await lockOrCreateAccount(tx, args.userId)
      return entitlementsFromAccount(account)
    })
  }

  async reserve(args: {
    entitlements: Entitlements
    expiresAt?: number
    kind: UsageEvent['kind']
    metadata?: Record<string, unknown>
    modelId?: string
    operationId: string
    requestFingerprint: string
    reservationId: string
    reservedCents: number
    userId: string
  }): Promise<UsageReservationResult> {
    const reservedMicros = centsToMicros(args.reservedCents)
    return await this.db.transaction(async (tx) => {
      const account = await lockOrCreateAccount(tx, args.userId)
      const existing = await selectReservationForUpdate(tx, args.reservationId)
      if (existing) {
        assertReservationIdentity(existing, {
          kind: args.kind,
          modelId: args.modelId,
          operationId: args.operationId,
          requestFingerprint: args.requestFingerprint,
          reservedMicros,
          userId: args.userId,
        })
        return {
          ok: true,
          entitlements: entitlementsFromAccount(account),
          replayed: true,
          reservationId: existing.status === 'released' || existing.status === 'expired'
            ? null
            : args.reservationId,
          reservedCents: microsToCents(Number(existing.reservedMicros)),
          status: existing.status,
        }
      }

      const availableMicros = availableMicrosFor(account)
      if (account.mode === 'budgeted' && availableMicros < reservedMicros) {
        return {
          ok: false,
          code: 'insufficient_budget',
          entitlements: entitlementsFromAccount(account),
          remainingCents: microsToCents(availableMicros),
          requiredCents: args.reservedCents,
        }
      }

      const now = new Date()
      await tx.execute(sql`
        INSERT INTO usage_reservations (
          id, user_id, kind, model_id, reserved_micros, status, metadata,
          expires_at, created_at, updated_at
        ) VALUES (
          ${args.reservationId}, ${args.userId}, ${args.kind}, ${args.modelId ?? null},
          ${reservedMicros}, 'reserved', ${JSON.stringify({
            ...(args.metadata ?? {}),
            operationId: args.operationId,
            requestFingerprint: args.requestFingerprint,
          })}::jsonb,
          ${new Date(args.expiresAt ?? Date.now() + DEFAULT_RESERVATION_TTL_MS)}, ${now}, ${now}
        )
      `)
      await tx.execute(sql`
        UPDATE usage_budget_accounts
        SET reserved_micros = reserved_micros + ${reservedMicros},
            version = version + 1,
            updated_at = ${now}
        WHERE user_id = ${args.userId}
      `)
      await insertTransaction(tx, {
        amountMicros: reservedMicros,
        reservationId: args.reservationId,
        type: 'reserve',
        userId: args.userId,
      })

      return {
        ok: true,
        entitlements: entitlementsFromAccount({
          ...account,
          reservedMicros: Number(account.reservedMicros) + reservedMicros,
        }),
        replayed: false,
        reservationId: args.reservationId,
        reservedCents: microsToCents(reservedMicros),
        status: 'reserved',
      }
    })
  }

  async finalize(args: {
    actualCostCents: number
    events?: UsageEvent[]
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }> {
    const actualMicros = centsToMicros(args.actualCostCents)
    const outcome: { error?: string; status: UsageReservationStatus } = await this.db.transaction(async (tx) => {
      const account = await lockOrCreateAccount(tx, args.userId)
      const reservation = await requireReservation(tx, args.reservationId, args.userId)
      if (reservation.status === 'finalized') return { status: 'finalized' }
      if (reservation.status !== 'reserved' && reservation.status !== 'reconcile_required') {
        return { status: reservation.status }
      }

      const reservedMicros = Number(reservation.reservedMicros)
      if (actualMicros > reservedMicros) {
        await updateReservationReconcile(tx, args.reservationId, 'actual_cost_exceeds_reservation')
        return { status: 'reconcile_required' as const, error: 'actual_cost_exceeds_reservation' }
      }
      const now = new Date()
      await tx.execute(sql`
        UPDATE usage_reservations
        SET status = 'finalized', actual_micros = ${actualMicros},
            provider_work_started = true, finalized_at = ${now}, updated_at = ${now}, error = NULL
        WHERE id = ${args.reservationId}
      `)
      await tx.execute(sql`
        UPDATE usage_budget_accounts
        SET reserved_micros = GREATEST(0, reserved_micros - ${reservedMicros}),
            used_micros = used_micros + ${actualMicros},
            version = version + 1,
            updated_at = ${now}
        WHERE user_id = ${args.userId}
      `)
      await insertTransaction(tx, {
        amountMicros: actualMicros,
        reservationId: args.reservationId,
        type: 'finalize',
        userId: args.userId,
      })
      await insertEvents(tx, {
        events: args.events ?? [],
        operationId: args.reservationId,
        reservationId: args.reservationId,
        userId: args.userId,
      })
      void account
      return { status: 'finalized' }
    })
    if ('error' in outcome && outcome.error) throw new Error(outcome.error)
    return { status: outcome.status }
  }

  async markStarted(args: {
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }> {
    return await this.db.transaction(async (tx) => {
      const reservation = await requireReservation(tx, args.reservationId, args.userId)
      if (reservation.status !== 'reserved') return { status: reservation.status }
      await tx.execute(sql`
        UPDATE usage_reservations
        SET provider_work_started = true, updated_at = ${new Date()}
        WHERE id = ${args.reservationId} AND user_id = ${args.userId} AND status = 'reserved'
      `)
      return { status: 'reserved' }
    })
  }

  async release(args: {
    providerWorkStarted?: boolean
    reason?: string
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }> {
    return await this.db.transaction(async (tx) => {
      await lockOrCreateAccount(tx, args.userId)
      const reservation = await requireReservation(tx, args.reservationId, args.userId)
      if (reservation.status !== 'reserved') return { status: reservation.status }
      if (args.providerWorkStarted || reservation.providerWorkStarted) {
        await updateReservationReconcile(tx, args.reservationId, args.reason)
        return { status: 'reconcile_required' }
      }

      const reservedMicros = Number(reservation.reservedMicros)
      const now = new Date()
      await tx.execute(sql`
        UPDATE usage_reservations
        SET status = 'released', reason = ${args.reason ?? null}, released_at = ${now}, updated_at = ${now}
        WHERE id = ${args.reservationId}
      `)
      await tx.execute(sql`
        UPDATE usage_budget_accounts
        SET reserved_micros = GREATEST(0, reserved_micros - ${reservedMicros}),
            version = version + 1,
            updated_at = ${now}
        WHERE user_id = ${args.userId}
      `)
      await insertTransaction(tx, {
        amountMicros: -reservedMicros,
        reservationId: args.reservationId,
        type: 'release',
        userId: args.userId,
      })
      return { status: 'released' }
    })
  }

  async markForReconcile(args: {
    errorMessage?: string
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }> {
    return await this.db.transaction(async (tx) => {
      const reservation = await requireReservation(tx, args.reservationId, args.userId)
      if (reservation.status === 'finalized' || reservation.status === 'released' || reservation.status === 'expired') {
        return { status: reservation.status }
      }
      await updateReservationReconcile(tx, args.reservationId, args.errorMessage)
      return { status: 'reconcile_required' }
    })
  }

  async recordBatch(args: {
    events: UsageEvent[]
    forceFreeTierLimits?: boolean
    operationId: string
    userId: string
  }): Promise<{ recorded: number }> {
    return await this.db.transaction(async (tx) => {
      await lockOrCreateAccount(tx, args.userId)
      const inserted = await insertEvents(tx, args)
      const totalMicros = inserted.reduce((total, event) => total + event.billableMicros, 0)
      if (totalMicros > 0) {
        await tx.execute(sql`
          UPDATE usage_budget_accounts
          SET used_micros = used_micros + ${totalMicros},
              version = version + 1,
              updated_at = now()
          WHERE user_id = ${args.userId}
        `)
        for (const event of inserted) {
          await insertTransaction(tx, {
            amountMicros: event.billableMicros,
            eventId: event.id,
            type: 'finalize',
            userId: args.userId,
          })
        }
      }
      return { recorded: inserted.length }
    })
  }

  async reconcileExpired(args: {
    limit?: number
    now?: number
  } = {}): Promise<{ reconcileRequired: number; released: number }> {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 1_000)
    const now = new Date(args.now ?? Date.now())
    const candidates = await this.db.execute<{
      id: string
      providerWorkStarted: boolean
      userId: string
    }>(sql`
      SELECT id, user_id AS "userId", provider_work_started AS "providerWorkStarted"
      FROM usage_reservations
      WHERE status = 'reserved' AND expires_at <= ${now}
      ORDER BY expires_at ASC
      LIMIT ${limit}
    `)
    let reconcileRequired = 0
    let released = 0
    for (const candidate of candidates.rows) {
      if (candidate.providerWorkStarted) {
        const result = await this.markForReconcile({
          errorMessage: 'reservation_expired_after_provider_work',
          reservationId: candidate.id,
          userId: candidate.userId,
        })
        if (result.status === 'reconcile_required') reconcileRequired += 1
      } else {
        const result = await this.release({
          reason: 'reservation_expired_before_provider_work',
          reservationId: candidate.id,
          userId: candidate.userId,
        })
        if (result.status === 'released') {
          await this.db.execute(sql`
            UPDATE usage_reservations SET status = 'expired', updated_at = ${now} WHERE id = ${candidate.id}
          `)
          released += 1
        }
      }
    }
    return { reconcileRequired, released }
  }
}

async function lockOrCreateAccount(tx: Transaction, userId: string): Promise<BudgetAccountRow> {
  await tx.execute(sql`
    INSERT INTO usage_budget_accounts (user_id, mode)
    VALUES (${userId}, 'unlimited')
    ON CONFLICT (user_id) DO NOTHING
  `)
  const result = await tx.execute<BudgetAccountRow>(sql`
    SELECT
      mode,
      included_micros AS "includedMicros",
      granted_micros AS "grantedMicros",
      used_micros AS "usedMicros",
      reserved_micros AS "reservedMicros"
    FROM usage_budget_accounts
    WHERE user_id = ${userId}
    FOR UPDATE
  `)
  const account = result.rows[0]
  if (!account) throw new Error(`Usage budget account could not be created for ${userId}`)
  return account
}

async function selectReservationForUpdate(tx: Transaction, id: string): Promise<ReservationRow | null> {
  const result = await tx.execute<ReservationRow>(sql`
    SELECT user_id AS "userId", kind, model_id AS "modelId",
           reserved_micros AS "reservedMicros", actual_micros AS "actualMicros",
           provider_work_started AS "providerWorkStarted", metadata, status
    FROM usage_reservations
    WHERE id = ${id}
    FOR UPDATE
  `)
  return result.rows[0] ?? null
}

async function requireReservation(tx: Transaction, id: string, userId: string): Promise<ReservationRow> {
  const reservation = await selectReservationForUpdate(tx, id)
  if (!reservation || reservation.userId !== userId) throw new Error('Usage reservation was not found')
  return reservation
}

function assertReservationIdentity(
  row: ReservationRow,
  expected: {
    kind: string
    modelId?: string
    operationId: string
    requestFingerprint: string
    reservedMicros: number
    userId: string
  },
): void {
  if (
    row.userId !== expected.userId ||
    Number(row.reservedMicros) !== expected.reservedMicros ||
    row.kind !== expected.kind ||
    (row.modelId ?? undefined) !== expected.modelId ||
    row.metadata?.operationId !== expected.operationId ||
    row.metadata?.requestFingerprint !== expected.requestFingerprint
  ) {
    throw new Error('Usage reservation id was reused with different parameters')
  }
}

async function updateReservationReconcile(tx: Transaction, id: string, error?: string): Promise<void> {
  await tx.execute(sql`
    UPDATE usage_reservations
    SET status = 'reconcile_required', provider_work_started = true,
        error = ${error ?? null}, updated_at = now()
    WHERE id = ${id}
  `)
}

async function insertEvents(tx: Transaction, args: {
  events: UsageEvent[]
  operationId: string
  reservationId?: string
  userId: string
}): Promise<Array<{ billableMicros: number; id: string }>> {
  const inserted: Array<{ billableMicros: number; id: string }> = []
  for (const [index, event] of args.events.entries()) {
    const id = event.eventId ?? `${args.operationId}:${index}`
    const billableMicros = centsToMicros(event.costCents)
    const providerCostMicros = event.providerCostUsd === undefined
      ? null
      : dollarsToMicros(event.providerCostUsd)
    const result = await tx.execute<{ id: string }>(sql`
      INSERT INTO usage_events (
        id, user_id, reservation_id, operation_id, kind, model_id,
        input_tokens, output_tokens, cached_tokens, provider_cost_micros,
        billable_cost_micros, metadata, occurred_at
      ) VALUES (
        ${id}, ${args.userId}, ${args.reservationId ?? null}, ${args.operationId},
        ${event.kind}, ${event.modelId ?? null}, ${event.inputTokens ?? null},
        ${event.outputTokens ?? null}, ${event.cachedTokens ?? null},
        ${providerCostMicros}, ${billableMicros},
        ${JSON.stringify({
          ...(event.metadata ?? {}),
          ...(event.durationSeconds === undefined ? {} : { durationSeconds: event.durationSeconds }),
        })}::jsonb, ${new Date(event.occurredAt)}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `)
    if (result.rows.length > 0) inserted.push({ billableMicros, id })
  }
  return inserted
}

async function insertTransaction(tx: Transaction, args: {
  amountMicros: number
  eventId?: string
  reservationId?: string
  type: 'reserve' | 'finalize' | 'release' | 'adjustment'
  userId: string
}): Promise<void> {
  await tx.execute(sql`
    INSERT INTO usage_budget_transactions (
      id, user_id, reservation_id, event_id, type, amount_micros
    ) VALUES (
      ${randomUUID()}, ${args.userId}, ${args.reservationId ?? null},
      ${args.eventId ?? null}, ${args.type}, ${args.amountMicros}
    )
  `)
}

function entitlementsFromAccount(account: BudgetAccountRow): Entitlements {
  const usedMicros = Number(account.usedMicros)
  const configuredTotalMicros = Number(account.includedMicros) + Number(account.grantedMicros)
  const totalMicros = account.mode === 'unlimited' ? UNLIMITED_TOTAL_MICROS : configuredTotalMicros
  const remainingMicros = account.mode === 'unlimited'
    ? UNLIMITED_TOTAL_MICROS
    : Math.max(0, totalMicros - usedMicros - Number(account.reservedMicros))
  return {
    tier: 'max',
    planKind: 'paid',
    creditsUsed: microsToCents(usedMicros) / 100,
    creditsTotal: microsToCents(totalMicros) / 100,
    budgetUsedCents: microsToCents(usedMicros),
    budgetTotalCents: microsToCents(totalMicros),
    budgetRemainingCents: microsToCents(remainingMicros),
    dailyUsage: { ask: 0, write: 0, agent: 0 },
    dailyLimits: {
      ask: Number.MAX_SAFE_INTEGER,
      write: Number.MAX_SAFE_INTEGER,
      agent: Number.MAX_SAFE_INTEGER,
    },
    localTranscriptionEnabled: true,
    lastSyncedAt: Date.now(),
  }
}

function availableMicrosFor(account: BudgetAccountRow): number {
  if (account.mode === 'unlimited') return UNLIMITED_TOTAL_MICROS
  return Math.max(
    0,
    Number(account.includedMicros) + Number(account.grantedMicros) -
      Number(account.usedMicros) - Number(account.reservedMicros),
  )
}

function centsToMicros(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Usage cost must be a finite non-negative number')
  return Math.round(value * MICROS_PER_CENT)
}

function dollarsToMicros(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Provider cost must be a finite non-negative number')
  return Math.round(value * 100 * MICROS_PER_CENT)
}

function microsToCents(value: number): number {
  return value / MICROS_PER_CENT
}
