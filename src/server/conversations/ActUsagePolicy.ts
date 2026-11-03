import 'server-only'

import { logger } from '@/server/observability/logger'
import { calculateLanguageModelReservationCostOrNull, calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import {
  billableBudgetCentsFromProviderUsd,
  finalizeProviderBudgetReservation,
  getPayerEntitlements,
  markProviderBudgetReconcile,
  markProviderBudgetStarted,
  releaseProviderBudgetReservation,
  reserveProviderBudget,
} from '@/server/billing/billing-runtime'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { OverlayRuntimeConfig } from '@/shared/config'
import type { ActConversationRepository } from './ActConversationRepository'
import type { UsageRepository } from '@/server/usage'

export type ActBudgetFailure = {
  payload: Record<string, unknown>
  statusCode: number
}

export type ActBudgetReservationResult =
  | { ok: true; reservationId: string | null }
  | { ok: false; failure: ActBudgetFailure }

export type ActFinishedUsage = {
  countAsRequest?: boolean
  workspaceId?: string
  /** Durable callers must not advance past a failed accounting write. */
  requireRecorded?: boolean
  inputTokens: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  /** Validated provider receipt, in USD; never supplied by a client. */
  providerCostUsd?: number
  /** A previously resolved catalog quote, never exposed as an exact provider receipt. */
  catalogCostUsd?: number
  modelId: string
  outputTokens: number
  reservationId: string | null
  userId: string
  operationId?: string
}

export interface ActUsagePolicy {
  getEntitlements(args: {
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<Entitlements | null>
  reserveForAttempt(args: {
    entitlements: Entitlements
    estimatedInputTokens: number
    idempotencyKey?: string | null
    maxOutputTokens: number
    modelId: string
    operationId: string
    paid: boolean
    requestFingerprint: string
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<ActBudgetReservationResult>
  recordFinishedUsage(args: ActFinishedUsage): Promise<{ finalized: boolean; reservationId: string | null }>
  markReservationStarted(args: {
    reservationId: string | null | undefined
    userId: string
  }): Promise<void>
  releaseReservation(args: {
    reason?: string
    reservationId: string | null | undefined
    userId: string
  }): Promise<void>
  markReservationForReconcile(args: {
    errorMessage?: string
    reservationId: string | null | undefined
    userId: string
  }): Promise<void>
}

const UNLIMITED_BUDGET_CENTS = Number.MAX_SAFE_INTEGER

export class UnlimitedUsagePolicy implements ActUsagePolicy {
  async getEntitlements(_args: {
    userId: string
  }): Promise<Entitlements> {
    return {
      tier: 'max',
      planKind: 'paid',
      creditsUsed: 0,
      creditsTotal: UNLIMITED_BUDGET_CENTS / 100,
      budgetUsedCents: 0,
      budgetTotalCents: UNLIMITED_BUDGET_CENTS,
      budgetRemainingCents: UNLIMITED_BUDGET_CENTS,
      dailyUsage: { ask: 0, write: 0, agent: 0 },
      dailyLimits: {
        ask: UNLIMITED_BUDGET_CENTS,
        write: UNLIMITED_BUDGET_CENTS,
        agent: UNLIMITED_BUDGET_CENTS,
      },
      overlayStorageBytesUsed: 0,
      overlayStorageBytesLimit: UNLIMITED_BUDGET_CENTS,
      localTranscriptionEnabled: true,
      lastSyncedAt: Date.now(),
    }
  }

  async reserveForAttempt(_args: {
    entitlements: Entitlements
    estimatedInputTokens: number
    idempotencyKey?: string | null
    maxOutputTokens: number
    modelId: string
    operationId: string
    paid: boolean
    requestFingerprint: string
    userId: string
  }): Promise<ActBudgetReservationResult> {
    return { ok: true, reservationId: null }
  }

  async recordFinishedUsage(_args: ActFinishedUsage): Promise<{ finalized: boolean; reservationId: string | null }> {
    return { finalized: false, reservationId: null }
  }
  async markReservationStarted(_args: {
    reservationId: string | null | undefined
    userId: string
  }): Promise<void> {}

  async releaseReservation(_args: {
    reason?: string
    reservationId: string | null | undefined
    userId: string
  }): Promise<void> {}

  async markReservationForReconcile(_args: {
    errorMessage?: string
    reservationId: string | null | undefined
    userId: string
  }): Promise<void> {}
}

type FinishedUsageEvent = {
  type: 'agent'
  modelId: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  countAsRequest?: boolean
  providerCostUsd?: number
  cost: number
  timestamp: number
}

function validateFinishedUsageReceipts(args: ActFinishedUsage): {
  cachedInputTokens: number
  cacheWriteTokens: number
} {
  const cachedInputTokens = args.cachedInputTokens ?? 0
  const cacheWriteTokens = args.cacheWriteTokens ?? 0
  if (![cachedInputTokens, cacheWriteTokens].every(value => Number.isSafeInteger(value) && value >= 0)
    || cachedInputTokens + cacheWriteTokens > args.inputTokens) {
    throw new Error('Invalid cached token usage.')
  }
  if (args.providerCostUsd !== undefined && (!Number.isFinite(args.providerCostUsd) || args.providerCostUsd < 0)) {
    throw new Error('Invalid provider cost receipt.')
  }
  if (args.catalogCostUsd !== undefined && (!Number.isFinite(args.catalogCostUsd) || args.catalogCostUsd < 0)) {
    throw new Error('Invalid catalog cost estimate.')
  }
  return { cachedInputTokens, cacheWriteTokens }
}

async function resolveFinishedUsageCost(
  args: ActFinishedUsage,
  cachedInputTokens: number,
  cacheWriteTokens: number,
): Promise<number | null> {
  return args.providerCostUsd ?? args.catalogCostUsd ?? await calculateLanguageModelTokenCostOrNull(
    args.modelId,
    args.inputTokens,
    cachedInputTokens,
    args.outputTokens,
    cacheWriteTokens,
  )
}

function buildFinishedUsageEvents(
  args: ActFinishedUsage,
  cachedInputTokens: number,
  costCents: number,
): FinishedUsageEvent[] {
  return [{
    type: 'agent',
    modelId: args.modelId,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cachedTokens: cachedInputTokens,
    ...(args.countAsRequest !== undefined ? { countAsRequest: args.countAsRequest } : {}),
    ...(args.providerCostUsd !== undefined ? { providerCostUsd: args.providerCostUsd } : {}),
    cost: costCents,
    timestamp: Date.now(),
  }]
}

export class BillingBackedActUsagePolicy implements ActUsagePolicy {
  constructor(private readonly deps: {
    repository: UsageRepository | Pick<ActConversationRepository, 'getEntitlements' | 'recordUsageBatch'>
    accountAllUsage?: boolean
  }) {}

  async getEntitlements(args: {
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<Entitlements | null> {
    const personal = await this.deps.repository.getEntitlements({ userId: args.userId })
    return await getPayerEntitlements({ ...args, fallbackEntitlements: personal ?? undefined })
  }

  async reserveForAttempt(args: {
    entitlements: Entitlements
    estimatedInputTokens: number
    idempotencyKey?: string | null
    maxOutputTokens: number
    modelId: string
    operationId: string
    paid: boolean
    requestFingerprint: string
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<ActBudgetReservationResult> {
    const estimatedProviderCostUsd = await calculateLanguageModelReservationCostOrNull(
      args.modelId,
      args.estimatedInputTokens,
      args.maxOutputTokens,
    )
    if (estimatedProviderCostUsd === null) {
      return {
        ok: false,
        failure: {
          payload: {
            error: 'pricing_missing',
            message: `Model ${args.modelId} is not priced for production use.`,
          },
          statusCode: 400,
        },
      }
    }
    const reservation = await reserveProviderBudget({
      userId: args.userId,
      entitlements: args.entitlements,
      idempotencyKey: args.idempotencyKey,
      providerCostUsd: estimatedProviderCostUsd,
      kind: 'agent',
      modelId: args.modelId,
      operationId: args.operationId,
      requestFingerprint: args.requestFingerprint,
      workspaceId: args.workspaceId,
      programmaticSubjectId: args.programmaticSubjectId,
    })
    if (!reservation.ok) {
      return {
        ok: false,
        failure: {
          payload: { ...reservation.payload, error: reservation.code },
          statusCode: reservation.status,
        },
      }
    }
    return { ok: true, reservationId: reservation.reservationId }
  }

  async recordFinishedUsage(args: ActFinishedUsage): Promise<{ finalized: boolean; reservationId: string | null }> {
    const { cachedInputTokens, cacheWriteTokens } = validateFinishedUsageReceipts(args)
    const providerCostUsd = await resolveFinishedUsageCost(args, cachedInputTokens, cacheWriteTokens)
    if (providerCostUsd === null) return await this.handleMissingFinishedUsagePricing(args)
    const costCents = billableBudgetCentsFromProviderUsd(providerCostUsd)
    if (!args.requireRecorded && costCents <= 0 && args.inputTokens <= 0 && args.outputTokens <= 0) {
      return { finalized: false, reservationId: args.reservationId }
    }

    const events = buildFinishedUsageEvents(args, cachedInputTokens, costCents)
    return await this.persistFinishedUsage(args, providerCostUsd, events)
  }

  private async handleMissingFinishedUsagePricing(args: ActFinishedUsage): Promise<{ finalized: boolean; reservationId: string | null }> {
    logger.error('[conversations/act] Missing pricing for completed provider call', { modelId: args.modelId })
    if (!args.reservationId) {
      if (args.requireRecorded) throw new Error('Model pricing requires reconciliation.')
      return { finalized: false, reservationId: args.reservationId }
    }
    await this.markReservationForReconcile({
      userId: args.userId,
      reservationId: args.reservationId,
      errorMessage: `pricing_missing:${args.modelId}`,
    }).catch((err) => logger.error('[conversations/act] Failed to mark reservation for reconcile:', summarizeErrorForLog(err)))
    if (args.requireRecorded) throw new Error('Model pricing requires reconciliation.')
    return { finalized: false, reservationId: null }
  }

  private async persistFinishedUsage(
    args: ActFinishedUsage,
    providerCostUsd: number,
    events: FinishedUsageEvent[],
  ): Promise<{ finalized: boolean; reservationId: string | null }> {
    try {
      if (args.reservationId) {
        const settlement = await finalizeProviderBudgetReservation({
          userId: args.userId,
          reservationId: args.reservationId,
          actualProviderCostUsd: providerCostUsd,
          events,
        })
        if (args.requireRecorded && (!settlement || !('status' in settlement) || settlement.status !== 'finalized')) {
          throw new Error('The model reservation has not settled.')
        }
        return { finalized: true, reservationId: null }
      }
      await this.recordFinishedUsageEvents(args, events)
      return { finalized: false, reservationId: null }
    } catch (err) {
      logger.error('[conversations/act] Failed to record usage:', summarizeErrorForLog(err))
      if (args.reservationId) {
        await this.markReservationForReconcile({
          userId: args.userId,
          reservationId: args.reservationId,
          errorMessage: summarizeErrorForLog(err),
        }).catch((reconcileErr) => logger.error('[conversations/act] Failed to mark reservation for reconcile:', summarizeErrorForLog(reconcileErr)))
        if (args.requireRecorded) throw new Error('Model usage could not be recorded; reconciliation is required.')
        return { finalized: false, reservationId: null }
      }
      if (args.requireRecorded) throw new Error('Model usage could not be recorded.')
      return { finalized: false, reservationId: args.reservationId }
    }
  }

  private async recordFinishedUsageEvents(args: ActFinishedUsage, events: FinishedUsageEvent[]): Promise<void> {
    if ('recordBatch' in this.deps.repository) {
      await this.deps.repository.recordBatch({
        operationId: args.operationId ?? `act_${globalThis.crypto.randomUUID()}`,
        userId: args.userId,
        ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
        events: events.map((event) => ({
          cachedTokens: event.cachedTokens,
          ...(args.countAsRequest !== undefined ? { countAsRequest: args.countAsRequest } : {}),
          ...(args.providerCostUsd !== undefined ? { providerCostUsd: args.providerCostUsd } : {}),
          costCents: event.cost,
          inputTokens: event.inputTokens,
          kind: event.type,
          modelId: event.modelId,
          occurredAt: event.timestamp,
          outputTokens: event.outputTokens,
        })),
      })
    } else {
      if (args.requireRecorded) throw new Error('Durable accounting requires an idempotent usage repository.')
      await this.deps.repository.recordUsageBatch({
        events,
        userId: args.userId,
      })
    }
  }

  async markReservationStarted(args: {
    reservationId: string | null | undefined
    userId: string
  }): Promise<void> {
    await markProviderBudgetStarted(args)
  }

  async releaseReservation(args: {
    reason?: string
    reservationId: string | null | undefined
    userId: string
  }): Promise<void> {
    if (!args.reservationId) return
    await releaseProviderBudgetReservation({
      userId: args.userId,
      reservationId: args.reservationId,
      reason: args.reason,
    })
  }

  async markReservationForReconcile(args: {
    errorMessage?: string
    reservationId: string | null | undefined
    userId: string
  }): Promise<void> {
    if (!args.reservationId) return
    await markProviderBudgetReconcile({
      userId: args.userId,
      reservationId: args.reservationId,
      errorMessage: args.errorMessage,
    })
  }
}

export function createActUsagePolicy(args: {
  repository: ActConversationRepository
  usageRepository: UsageRepository
  runtimeConfig: OverlayRuntimeConfig | null
}): ActUsagePolicy {
  return new BillingBackedActUsagePolicy({
    repository: args.usageRepository,
  })
}
