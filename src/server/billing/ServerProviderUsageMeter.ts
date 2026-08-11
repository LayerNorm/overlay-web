import 'server-only'

import { createHash } from 'node:crypto'
import type { UsageEvent, UsageRepository, UsageSpendKind } from '@/server/usage'
import {
  billableBudgetCentsFromProviderUsd,
  createRequestBoundBudgetReservationId,
  finalizeProviderBudgetReservation,
  markProviderBudgetStarted,
  releaseProviderBudgetReservation,
  reserveProviderBudget,
} from './billing-runtime'
import { logSecurityEvent } from '@/server/observability/security-events'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'

export class ServerProviderUsageMeter {
  constructor(private readonly usage: UsageRepository) {}

  async run<T>(args: {
    execute: () => Promise<T>
    idempotencyKey?: string
    kind: UsageSpendKind
    modelId: string
    operationId: string
    providerCostUsd: number
    requestFingerprint: string
    usageEvent?: Omit<UsageEvent, 'costCents' | 'kind' | 'modelId' | 'occurredAt'>
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<T> {
    const entitlements = await this.usage.getEntitlements({ userId: args.userId })
    if (!entitlements) throw new Error('provider_usage_identity_not_found')
    if (args.workspaceId) {
      const reservation = await reserveProviderBudget({
        entitlements,
        idempotencyKey: args.idempotencyKey,
        kind: args.kind,
        modelId: args.modelId,
        operationId: args.operationId,
        programmaticSubjectId: args.programmaticSubjectId,
        providerCostUsd: args.providerCostUsd,
        requestFingerprint: args.requestFingerprint,
        userId: args.userId,
        workspaceId: args.workspaceId,
      })
      if (!reservation.ok) throw new Error(reservation.code)
      let providerWorkStarted = false
      try {
        await markProviderBudgetStarted({ reservationId: reservation.reservationId, userId: args.userId })
        providerWorkStarted = true
        const value = await args.execute()
        await finalizeProviderBudgetReservation({
          actualProviderCostUsd: args.providerCostUsd,
          events: [{
            ...args.usageEvent,
            cost: billableBudgetCentsFromProviderUsd(args.providerCostUsd),
            modelId: args.modelId,
            timestamp: Date.now(),
            type: args.kind,
          }],
          reservationId: reservation.reservationId,
          userId: args.userId,
        })
        return value
      } catch (error) {
        await releaseProviderBudgetReservation({
          providerWorkStarted,
          reason: error instanceof Error ? error.message : 'provider_operation_failed',
          reservationId: reservation.reservationId,
          userId: args.userId,
        }).catch((_error) => undefined)
        throw error
      }
    }
    const reservedCents = billableBudgetCentsFromProviderUsd(args.providerCostUsd)
    const reservationId = createRequestBoundBudgetReservationId({
      discriminator: `${args.kind}:${args.modelId}`,
      idempotencyKey: args.idempotencyKey ?? args.operationId,
      operationId: args.operationId,
      requestFingerprint: args.requestFingerprint,
      userId: args.userId,
    })
    const reservation = await this.usage.reserve({
      entitlements,
      kind: args.kind,
      modelId: args.modelId,
      operationId: args.operationId,
      requestFingerprint: args.requestFingerprint,
      reservationId,
      reservedCents,
      userId: args.userId,
    }).catch((error) => {
      this.logBoundaryEvent('usage_reservation_integrity_failure', args, {
        reason: error instanceof Error && /mismatch|reused/.test(error.message)
          ? 'reservation_parameter_mismatch'
          : 'reservation_backend_error',
      }, 'error')
      throw error
    })
    if (!reservation.ok) {
      this.logBoundaryEvent('owner_funded_budget_declined', args, {
        requiredCents: reservation.requiredCents,
        remainingCents: reservation.remainingCents,
      })
      throw new Error('insufficient_budget')
    }
    if (reservation.replayed || reservation.status !== 'reserved') {
      this.logBoundaryEvent('usage_reservation_replay_blocked', args, {
        reservationStatus: reservation.status,
      })
      throw new Error(`provider_operation_already_reserved:${reservation.status}`)
    }

    let providerWorkStarted = false
    try {
      const started = await this.usage.markStarted({ reservationId, userId: args.userId })
      if (started.status !== 'reserved') {
        throw new Error(`provider_operation_not_startable:${started.status}`)
      }
      providerWorkStarted = true
      const value = await args.execute()
      await this.usage.finalize({
        actualCostCents: reservedCents,
        events: [{
          ...args.usageEvent,
          costCents: reservedCents,
          kind: args.kind,
          modelId: args.modelId,
          occurredAt: Date.now(),
          providerCostUsd: args.providerCostUsd,
        }],
        reservationId,
        userId: args.userId,
      })
      return value
    } catch (error) {
      await this.usage.release({
        providerWorkStarted,
        reason: error instanceof Error ? error.message : 'provider_operation_failed',
        reservationId,
        userId: args.userId,
      }).catch((_error) => undefined)
      throw error
    }
  }

  private logBoundaryEvent(
    type: string,
    args: {
      kind: UsageSpendKind
      modelId: string
      operationId: string
      userId: string
    },
    details: Record<string, unknown>,
    level: 'warning' | 'error' = 'warning',
  ): void {
    logSecurityEvent(type, {
      ...details,
      kind: args.kind,
      modelId: args.modelId.slice(0, 160),
      operationId: args.operationId.slice(0, 160),
      userHash: hashOperationalIdentifier('security-user:v1', args.userId),
    }, level)
  }
}

export function providerRequestFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
