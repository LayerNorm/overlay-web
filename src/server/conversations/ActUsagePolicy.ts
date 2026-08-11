import 'server-only'

import { logger } from '@/server/observability/logger'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { isPremiumModel } from '@/server/ai/pricing'
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
import type { AppDataProvider } from '@/server/app-data/capabilities'
import type { ActConversationRepository } from './ActConversationRepository'
import type { UsageRepository } from '@/server/usage'

export type ActBudgetFailure = {
  payload: Record<string, unknown>
  statusCode: number
}

export type ActBudgetReservationResult =
  | { ok: true; reservationId: string | null }
  | { ok: false; failure: ActBudgetFailure }

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
  recordFinishedUsage(args: {
    forceFreeTierLimits: boolean
    inputTokens: number
    modelId: string
    outputTokens: number
    reservationId: string | null
    userId: string
  }): Promise<{ finalized: boolean; reservationId: string | null }>
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

  async recordFinishedUsage(_args: {
    forceFreeTierLimits: boolean
    inputTokens: number
    modelId: string
    outputTokens: number
    reservationId: string | null
    userId: string
  }): Promise<{ finalized: boolean; reservationId: string | null }> {
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
    if (!this.deps.accountAllUsage && (!args.paid || !isPremiumModel(args.modelId))) {
      // Free-tier and non-premium paths skip the paid budget reservation, but
      // we still enforce a pre-check against the user's remaining credits so
      // that a free-tier user who has exhausted their allocation is blocked
      // BEFORE the provider call — not after usage is recorded.
      if (args.entitlements.planKind === 'free' || args.entitlements.tier === 'free') {
        const remainingCredits = (args.entitlements.creditsTotal ?? 0) - (args.entitlements.creditsUsed ?? 0)
        if (remainingCredits <= 0) {
          return {
            ok: false,
            failure: {
              payload: {
                error: 'free_tier_limit_exceeded',
                message: 'Your free tier usage limit has been reached. Upgrade to a paid plan for more usage.',
              },
              statusCode: 402,
            },
          }
        }
      }
      return { ok: true, reservationId: null }
    }
    const estimatedProviderCostUsd = await calculateLanguageModelTokenCostOrNull(
      args.modelId,
      args.estimatedInputTokens,
      0,
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

  async recordFinishedUsage(args: {
    forceFreeTierLimits: boolean
    inputTokens: number
    modelId: string
    outputTokens: number
    reservationId: string | null
    userId: string
  }): Promise<{ finalized: boolean; reservationId: string | null }> {
    const providerCostUsd = await calculateLanguageModelTokenCostOrNull(
      args.modelId,
      args.inputTokens,
      0,
      args.outputTokens,
    )
    if (providerCostUsd === null) {
      logger.error('[conversations/act] Missing pricing for completed provider call', { modelId: args.modelId })
      if (args.reservationId) {
        await this.markReservationForReconcile({
          userId: args.userId,
          reservationId: args.reservationId,
          errorMessage: `pricing_missing:${args.modelId}`,
        }).catch((err) => logger.error('[conversations/act] Failed to mark reservation for reconcile:', summarizeErrorForLog(err)))
        return { finalized: false, reservationId: null }
      }
      return { finalized: false, reservationId: args.reservationId }
    }

    const costCents = billableBudgetCentsFromProviderUsd(providerCostUsd)
    if (costCents <= 0 && args.inputTokens <= 0 && args.outputTokens <= 0) {
      return { finalized: false, reservationId: args.reservationId }
    }

    const events = [{
      type: 'agent' as const,
      modelId: args.modelId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cachedTokens: 0,
      cost: costCents,
      timestamp: Date.now(),
    }]

    try {
      if (args.reservationId) {
        await finalizeProviderBudgetReservation({
          userId: args.userId,
          reservationId: args.reservationId,
          actualProviderCostUsd: providerCostUsd,
          events,
        })
        return { finalized: true, reservationId: null }
      }
      if ('recordBatch' in this.deps.repository) {
        await this.deps.repository.recordBatch({
          operationId: `act_${globalThis.crypto.randomUUID()}`,
          userId: args.userId,
          forceFreeTierLimits: args.forceFreeTierLimits,
          events: events.map((event) => ({
            cachedTokens: event.cachedTokens,
            costCents: event.cost,
            inputTokens: event.inputTokens,
            kind: event.type,
            modelId: event.modelId,
            occurredAt: event.timestamp,
            outputTokens: event.outputTokens,
          })),
        })
      } else {
        await this.deps.repository.recordUsageBatch({
          events,
          forceFreeTierLimits: args.forceFreeTierLimits,
          userId: args.userId,
        })
      }
      return { finalized: false, reservationId: null }
    } catch (err) {
      logger.error('[conversations/act] Failed to record usage:', summarizeErrorForLog(err))
      if (args.reservationId) {
        await this.markReservationForReconcile({
          userId: args.userId,
          reservationId: args.reservationId,
          errorMessage: summarizeErrorForLog(err),
        }).catch((reconcileErr) => logger.error('[conversations/act] Failed to mark reservation for reconcile:', summarizeErrorForLog(reconcileErr)))
        return { finalized: false, reservationId: null }
      }
      return { finalized: false, reservationId: args.reservationId }
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
  appDataProvider: AppDataProvider
  repository: ActConversationRepository
  usageRepository: UsageRepository
  runtimeConfig: OverlayRuntimeConfig | null
}): ActUsagePolicy {
  return new BillingBackedActUsagePolicy({
    accountAllUsage: args.appDataProvider === 'postgres',
    repository: args.usageRepository,
  })
}
