import 'server-only'

import type { Entitlements } from '@/shared/app/app-contracts'

export type UsageSpendKind =
  | 'ask'
  | 'write'
  | 'agent'
  | 'embedding'
  | 'transcription'
  | 'generation'
  | 'sandbox'

export type UsageReservationStatus =
  | 'reserved'
  | 'finalized'
  | 'released'
  | 'reconcile_required'
  | 'expired'

export type UsageEvent = {
  cachedTokens?: number
  costCents: number
  eventId?: string
  inputTokens?: number
  kind: UsageSpendKind
  metadata?: Record<string, unknown>
  modelId?: string
  occurredAt: number
  outputTokens?: number
  providerCostUsd?: number
}

export type UsageReservationResult =
  | {
      ok: true
      entitlements: Entitlements
      reservationId: string | null
      reservedCents: number
    }
  | {
      ok: false
      code: 'insufficient_budget'
      entitlements: Entitlements
      remainingCents: number
      requiredCents: number
    }

export interface UsageRepository {
  getEntitlements(args: { userId: string }): Promise<Entitlements | null>
  reserve(args: {
    entitlements: Entitlements
    expiresAt?: number
    kind: UsageSpendKind
    metadata?: Record<string, unknown>
    modelId?: string
    reservationId: string
    reservedCents: number
    userId: string
  }): Promise<UsageReservationResult>
  finalize(args: {
    actualCostCents: number
    events?: UsageEvent[]
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }>
  release(args: {
    providerWorkStarted?: boolean
    reason?: string
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }>
  markForReconcile(args: {
    errorMessage?: string
    reservationId: string
    userId: string
  }): Promise<{ status: UsageReservationStatus }>
  recordBatch(args: {
    events: UsageEvent[]
    forceFreeTierLimits?: boolean
    operationId: string
    userId: string
  }): Promise<{ recorded: number }>
  reconcileExpired(args?: {
    limit?: number
    now?: number
  }): Promise<{ reconcileRequired: number; released: number }>
}
