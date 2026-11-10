import 'server-only'

import { logger } from '@/server/observability/logger'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import {
  billableBudgetCentsFromProviderUsd,
  ensureProviderBudgetNotLow,
  getPayerEntitlements,
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

export type ActBudgetCheckResult =
  | { ok: true }
  | { ok: false; failure: ActBudgetFailure }

export type ActUsageRecordResult = { recorded: boolean; budgetLow: boolean }

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
  userId: string
  programmaticSubjectId?: string
  /** Unique per call: the charge is idempotent on it. */
  operationId?: string
}

export interface ActUsagePolicy {
  getEntitlements(args: {
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<Entitlements | null>
  /** Refuses only when the payer has under 2% of its budget left (after a top-up) or a spend limit is used up. */
  ensureBudgetNotLow(args: {
    entitlements: Entitlements
    modelId: string
    operationId: string
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<ActBudgetCheckResult>
  /** Charges the actual cost directly; `budgetLow` means the caller should take no further steps. */
  recordFinishedUsage(args: ActFinishedUsage): Promise<ActUsageRecordResult>
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

  async ensureBudgetNotLow(): Promise<ActBudgetCheckResult> {
    return { ok: true }
  }

  async recordFinishedUsage(_args: ActFinishedUsage): Promise<ActUsageRecordResult> {
    return { recorded: false, budgetLow: false }
  }
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

  async ensureBudgetNotLow(args: {
    entitlements: Entitlements
    modelId: string
    operationId: string
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<ActBudgetCheckResult> {
    const check = await ensureProviderBudgetNotLow({ ...args, kind: 'agent' })
    if (check.ok) return { ok: true }
    return { ok: false, failure: { payload: { ...check.payload, error: check.code }, statusCode: check.status } }
  }

  async recordFinishedUsage(args: ActFinishedUsage): Promise<ActUsageRecordResult> {
    const { cachedInputTokens, cacheWriteTokens } = validateFinishedUsageReceipts(args)
    const providerCostUsd = await resolveFinishedUsageCost(args, cachedInputTokens, cacheWriteTokens)
    if (providerCostUsd === null) {
      logger.error('[conversations/act] Missing pricing for completed provider call', { modelId: args.modelId })
      if (args.requireRecorded) throw new Error('Model pricing requires reconciliation.')
      return { recorded: false, budgetLow: false }
    }
    const costCents = billableBudgetCentsFromProviderUsd(providerCostUsd)
    if (!args.requireRecorded && costCents <= 0 && args.inputTokens <= 0 && args.outputTokens <= 0) {
      return { recorded: false, budgetLow: false }
    }
    const events = buildFinishedUsageEvents(args, cachedInputTokens, costCents)
    try {
      return { recorded: true, budgetLow: await this.recordFinishedUsageEvents(args, events) }
    } catch (err) {
      logger.error('[conversations/act] Failed to record usage:', summarizeErrorForLog(err))
      if (args.requireRecorded) throw new Error('Model usage could not be recorded.')
      return { recorded: false, budgetLow: false }
    }
  }

  private async recordFinishedUsageEvents(args: ActFinishedUsage, events: FinishedUsageEvent[]): Promise<boolean> {
    if ('recordBatch' in this.deps.repository) {
      const result = await this.deps.repository.recordBatch({
        operationId: args.operationId ?? `act_${globalThis.crypto.randomUUID()}`,
        userId: args.userId,
        ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
        ...(args.programmaticSubjectId ? { programmaticSubjectId: args.programmaticSubjectId } : {}),
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
      return result.budgetLow
    }
    if (args.requireRecorded) throw new Error('Durable accounting requires an idempotent usage repository.')
    await this.deps.repository.recordUsageBatch({
      events,
      userId: args.userId,
    })
    return false
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
