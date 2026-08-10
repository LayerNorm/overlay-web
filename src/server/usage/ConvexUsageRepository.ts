import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Entitlements } from '@/shared/app/app-contracts'
import type {
  UsageEvent,
  UsageReconciliationQueueItem,
  UsageReconciliationSweepResult,
  UsageRepository,
  UsageReservationResult,
  UsageReservationStatus,
} from './UsageRepository'

export class ConvexUsageRepository implements UsageRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async getEntitlements(args: { userId: string }): Promise<Entitlements | null> {
    return await convex.query<Entitlements | null>('platform/usage:getEntitlementsByServer', {
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
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
    let result: {
      idempotent: boolean
      reservationId: string
      reservedCents: number
      status: UsageReservationStatus
    } | null
    try {
      result = await convex.mutation('platform/usage:reserveBudgetByServer', {
        expiresAt: args.expiresAt,
        kind: args.kind,
        modelId: args.modelId,
        operationId: args.operationId,
        requestFingerprint: args.requestFingerprint,
        reservationId: args.reservationId,
        reservedCents: args.reservedCents,
        serverSecret: this.serverSecret,
        userId: args.userId,
      }, { throwOnError: true })
    } catch (error) {
      if (error instanceof Error && /insufficient_budget|paid plan required/.test(error.message)) {
        return {
          ok: false,
          code: 'insufficient_budget',
          entitlements: args.entitlements,
          remainingCents: Math.max(0, args.entitlements.budgetRemainingCents ?? 0),
          requiredCents: args.reservedCents,
        }
      }
      throw error
    }
    if (!result) throw new Error('Failed to reserve usage budget')
    if (result.status !== 'reserved' && result.status !== 'finalized') {
      throw new Error(`Reservation ${args.reservationId} is already ${result.status}`)
    }
    return {
      ok: true,
      entitlements: args.entitlements,
      replayed: result.idempotent,
      reservationId: args.reservationId,
      reservedCents: args.reservedCents,
      status: result.status,
    }
  }

  async finalize(args: {
    actualCostCents: number
    events?: UsageEvent[]
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }> {
    const result = await convex.mutation<{
      error?: string
      status: UsageReservationStatus
    }>('platform/usage:finalizeBudgetReservationByServer', {
      actualCents: args.actualCostCents,
      events: args.events?.map(toConvexEvent),
      reservationId: args.reservationId,
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
    if (!result) throw new Error('Failed to finalize usage reservation')
    if (result.error) throw new Error(result.error)
    return { status: result.status }
  }

  async markStarted(args: {
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }> {
    const result = await convex.mutation<{ status: UsageReservationStatus | 'missing' }>(
      'platform/usage:markBudgetReservationStartedByServer',
      {
        reservationId: args.reservationId,
        serverSecret: this.serverSecret,
        userId: args.userId,
      },
      { throwOnError: true },
    )
    if (!result || result.status === 'missing') throw new Error('Usage reservation not found before provider start')
    return { status: result.status }
  }

  async release(args: {
    providerWorkStarted?: boolean
    reason?: string
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }> {
    const result = await convex.mutation<{ status: UsageReservationStatus | 'missing' }>('platform/usage:releaseBudgetReservationByServer', {
      providerWorkStarted: args.providerWorkStarted,
      reason: args.reason,
      reservationId: args.reservationId,
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
    if (!result) throw new Error('Failed to release usage reservation')
    return { status: result.status === 'missing' ? 'released' : result.status }
  }

  async markForReconcile(args: {
    errorMessage?: string
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }> {
    const result = await convex.mutation<{ status: UsageReservationStatus | 'missing' }>('platform/usage:markBudgetReservationReconcileByServer', {
      errorMessage: args.errorMessage,
      reservationId: args.reservationId,
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
    if (!result) throw new Error('Failed to mark usage reservation for reconciliation')
    return { status: result.status === 'missing' ? 'reconcile_required' : result.status }
  }

  async listReconciliationQueue(args: {
    limit?: number
    updatedBefore?: number
  } = {}): Promise<UsageReconciliationQueueItem[]> {
    return await convex.query<UsageReconciliationQueueItem[]>(
      'platform/usage:listBudgetReservationReconciliationByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    ) ?? []
  }

  async resolveReconciliation(args: {
    actualCostCents?: number
    evidence: { reason: string; reference: string; source: string }
    reservationId: string
    resolution: 'finalize' | 'release'
    userId: string
  }): Promise<{
    finalizedCents?: number
    idempotent: boolean
    status: 'finalized' | 'released'
  }> {
    const result = await convex.mutation<{
      finalizedCents?: number
      idempotent: boolean
      status: 'finalized' | 'released'
    }>('platform/usage:resolveBudgetReservationReconciliationByServer', {
      actualCents: args.actualCostCents,
      evidence: args.evidence,
      reservationId: args.reservationId,
      resolution: args.resolution,
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
    if (!result) throw new Error('Failed to resolve usage reservation reconciliation')
    return result
  }

  async recordBatch(args: {
    events: UsageEvent[]
    forceFreeTierLimits?: boolean
    operationId: string
    userId: string
  }): Promise<{ recorded: number }> {
    const result = await convex.mutation<{ recorded?: number }>('platform/usage:recordBatch', {
      events: args.events.map(toConvexEvent),
      forceFreeTierLimits: args.forceFreeTierLimits,
      operationId: args.operationId,
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
    if (!result) throw new Error('Failed to record usage batch')
    return { recorded: result.recorded ?? args.events.length }
  }

  async reconcileExpired(args: {
    limit?: number
    now?: number
  } = {}): Promise<UsageReconciliationSweepResult> {
    const result = await convex.mutation<UsageReconciliationSweepResult>(
      'platform/usage:reconcileExpiredBudgetReservationsByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
    if (!result) throw new Error('Failed to reconcile expired usage reservations')
    return result
  }
}

function toConvexEvent(event: UsageEvent) {
  return {
    cachedTokens: event.cachedTokens,
    cost: event.costCents,
    durationSeconds: event.durationSeconds,
    inputTokens: event.inputTokens,
    modelId: event.modelId,
    outputTokens: event.outputTokens,
    timestamp: event.occurredAt,
    type: event.kind,
  }
}
