import 'server-only'

import {
  BillingBackedActUsagePolicy,
  type ActBudgetCheckResult,
  type ActBudgetFailure,
  type ActUsagePolicy,
} from './ActUsagePolicy'
import type { ActConversationRepository } from './ActConversationRepository'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'

export type {
  ActBudgetCheckResult,
  ActBudgetFailure,
}

export class ActUsageBudgetService {
  private readonly policy: ActUsagePolicy

  constructor(deps: {
    policy?: ActUsagePolicy
    repository: ActConversationRepository
  }) {
    this.policy = deps.policy ?? new BillingBackedActUsagePolicy({
      repository: deps.repository,
    })
  }

  ensureBudgetNotLow(...args: Parameters<ActUsagePolicy['ensureBudgetNotLow']>): Promise<ActBudgetCheckResult> {
    if (isByokModelId(args[0].modelId)) return Promise.resolve({ ok: true })
    return this.policy.ensureBudgetNotLow(...args)
  }

  recordFinishedUsage(...args: Parameters<ActUsagePolicy['recordFinishedUsage']>) {
    if (isByokModelId(args[0].modelId)) {
      return Promise.resolve({ recorded: false, budgetLow: false })
    }
    return this.policy.recordFinishedUsage(...args)
  }
}
