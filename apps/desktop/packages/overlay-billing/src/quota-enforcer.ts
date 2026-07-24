import { getBudgetTotals, isPaidPlan } from './entitlements'
import type { BillingProvider, Entitlements, UsageKind } from './types'

export type QuotaFailureCode =
  | 'daily_limit_exceeded'
  | 'insufficient_budget'
  | 'storage_limit_exceeded'
  | 'transcription_limit_exceeded'

export interface QuotaRequest {
  userId: string
  kind?: Extract<UsageKind, 'ask' | 'write' | 'agent'>
  minimumBudgetCents?: number
  storageBytesRequested?: number
  transcriptionSecondsRequested?: number
}

export interface QuotaDecision {
  allowed: boolean
  entitlements: Entitlements
  code?: QuotaFailureCode
  message?: string
  remaining?: number
}

export class BillingQuotaError extends Error {
  constructor(readonly decision: QuotaDecision) {
    super(decision.message ?? decision.code ?? 'Billing quota exceeded')
    this.name = 'BillingQuotaError'
  }
}

export class QuotaEnforcer {
  constructor(private readonly provider: Pick<BillingProvider, 'getEntitlements'>) {}

  async check(request: QuotaRequest): Promise<QuotaDecision> {
    const entitlements = await this.provider.getEntitlements(request.userId)
    return evaluateQuota(entitlements, request)
  }

  async assertAllowed(request: QuotaRequest): Promise<Entitlements> {
    const decision = await this.check(request)
    if (!decision.allowed) {
      throw new BillingQuotaError(decision)
    }
    return decision.entitlements
  }
}

export function evaluateQuota(entitlements: Entitlements, request: Omit<QuotaRequest, 'userId'>): QuotaDecision {
  if (request.kind && entitlements.dailyLimits) {
    const used = entitlements.dailyUsage[request.kind] ?? 0
    const limit = entitlements.dailyLimits[request.kind] ?? 0
    if (limit > 0 && used >= limit) {
      return {
        allowed: false,
        entitlements,
        code: 'daily_limit_exceeded',
        message: `${request.kind} daily quota exceeded`,
        remaining: 0,
      }
    }
  }

  if (request.minimumBudgetCents && request.minimumBudgetCents > 0) {
    const budget = getBudgetTotals(entitlements)
    if (!isPaidPlan(entitlements) || budget.remainingCents < request.minimumBudgetCents) {
      return {
        allowed: false,
        entitlements,
        code: 'insufficient_budget',
        message: 'Not enough billing budget remaining',
        remaining: budget.remainingCents,
      }
    }
  }

  if (request.storageBytesRequested && request.storageBytesRequested > 0) {
    const used = entitlements.overlayStorageBytesUsed ?? 0
    const limit = entitlements.overlayStorageBytesLimit ?? 0
    if (limit > 0 && used + request.storageBytesRequested > limit) {
      return {
        allowed: false,
        entitlements,
        code: 'storage_limit_exceeded',
        message: 'Storage quota exceeded',
        remaining: Math.max(0, limit - used),
      }
    }
  }

  if (request.transcriptionSecondsRequested && request.transcriptionSecondsRequested > 0) {
    const used = entitlements.transcriptionSecondsUsed ?? 0
    const limit = entitlements.transcriptionSecondsLimit ?? 0
    if (limit > 0 && used + request.transcriptionSecondsRequested > limit) {
      return {
        allowed: false,
        entitlements,
        code: 'transcription_limit_exceeded',
        message: 'Transcription quota exceeded',
        remaining: Math.max(0, limit - used),
      }
    }
  }

  return { allowed: true, entitlements }
}
