import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Entitlements } from '@/shared/app/app-contracts'
import type {
  UsageEvent,
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
    kind: UsageEvent['kind']
    modelId?: string
    reservationId: string
    reservedCents: number
    userId: string
  }): Promise<UsageReservationResult> {
    await convex.mutation('platform/usage:reserveBudgetByServer', {
      kind: args.kind,
      modelId: args.modelId,
      reservationId: args.reservationId,
      reservedCents: args.reservedCents,
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
    return {
      ok: true,
      entitlements: args.entitlements,
      reservationId: args.reservationId,
      reservedCents: args.reservedCents,
    }
  }

  async finalize(args: {
    actualCostCents: number
    events?: UsageEvent[]
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }> {
    await convex.mutation('platform/usage:finalizeBudgetReservationByServer', {
      actualCents: args.actualCostCents,
      events: args.events?.map(toConvexEvent),
      reservationId: args.reservationId,
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
    return { status: 'finalized' }
  }

  async release(args: {
    providerWorkStarted?: boolean
    reason?: string
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }> {
    await convex.mutation('platform/usage:releaseBudgetReservationByServer', {
      providerWorkStarted: args.providerWorkStarted,
      reason: args.reason,
      reservationId: args.reservationId,
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
    return { status: args.providerWorkStarted ? 'reconcile_required' : 'released' }
  }

  async markForReconcile(args: {
    errorMessage?: string
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }> {
    await convex.mutation('platform/usage:markBudgetReservationReconcileByServer', {
      errorMessage: args.errorMessage,
      reservationId: args.reservationId,
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
    return { status: 'reconcile_required' }
  }

  async recordBatch(args: {
    events: UsageEvent[]
    forceFreeTierLimits?: boolean
    operationId: string
    userId: string
  }): Promise<{ recorded: number }> {
    await convex.mutation('platform/usage:recordBatch', {
      events: args.events.map(toConvexEvent),
      forceFreeTierLimits: args.forceFreeTierLimits,
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
    return { recorded: args.events.length }
  }

  async reconcileExpired(): Promise<{ reconcileRequired: number; released: number }> {
    return { reconcileRequired: 0, released: 0 }
  }
}

function toConvexEvent(event: UsageEvent) {
  return {
    cachedTokens: event.cachedTokens,
    cost: event.costCents,
    inputTokens: event.inputTokens,
    modelId: event.modelId,
    outputTokens: event.outputTokens,
    timestamp: event.occurredAt,
    type: event.kind,
  }
}
