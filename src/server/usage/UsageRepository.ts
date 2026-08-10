import 'server-only'

import type { Entitlements } from '@/shared/app/app-contracts'
import type {
  UsageReconciliationEvidence,
  UsageReconciliationResolution,
} from '@/shared/billing/usage-reconciliation'
import type { ResolvedBillingPayer } from '@/shared/billing/billing-payer'

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
  durationSeconds?: number
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
      replayed: boolean
      reservationId: string | null
      reservedCents: number
      status: UsageReservationStatus
    }
  | {
      ok: false
      code: 'insufficient_budget' | 'spend_limit_exceeded'
      entitlements: Entitlements
      remainingCents: number
      requiredCents: number
    }

export type UsageReconciliationQueueItem = {
  createdAt: number
  errorMessage?: string
  kind: UsageSpendKind
  modelId?: string
  providerWorkCompleted: boolean
  providerWorkStarted: boolean
  reconciliationAttempts: number
  reconciliationLastAttemptAt?: number
  reservationId: string
  reservedCents: number
  updatedAt: number
  userId: string
}

export type UsageReconciliationSweepResult = {
  oldestReconciliationUpdatedAt?: number
  pendingReconciliation: number
  reconcileRequired: number
  reconciliationQueueTruncated: boolean
  released: number
}

export interface UsageRepository {
  getEntitlements(args: { userId: string }): Promise<Entitlements | null>
  reserve(args: {
    entitlements: Entitlements
    expiresAt?: number
    kind: UsageSpendKind
    metadata?: Record<string, unknown>
    modelId?: string
    operationId: string
    requestFingerprint: string
    reservationId: string
    reservedCents: number
    userId: string
  }): Promise<UsageReservationResult>
  reserveWorkspace(args: {
    expiresAt?: number
    kind: UsageSpendKind
    metadata?: Record<string, unknown>
    modelId?: string
    operationId: string
    payer: ResolvedBillingPayer & { scope: 'workspace' }
    requestFingerprint: string
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
  markStarted(args: {
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
  listReconciliationQueue(args?: {
    limit?: number
    updatedBefore?: number
  }): Promise<UsageReconciliationQueueItem[]>
  resolveReconciliation(args: {
    actualCostCents?: number
    evidence: UsageReconciliationEvidence
    reservationId: string
    resolution: UsageReconciliationResolution
    userId: string
  }): Promise<{
    finalizedCents?: number
    idempotent: boolean
    status: Extract<UsageReservationStatus, 'finalized' | 'released'>
  }>
  recordBatch(args: {
    events: UsageEvent[]
    forceFreeTierLimits?: boolean
    operationId: string
    userId: string
  }): Promise<{ recorded: number }>
  reconcileExpired(args?: {
    limit?: number
    now?: number
  }): Promise<UsageReconciliationSweepResult>
}
