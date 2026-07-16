import 'server-only'

import {
  BillingBackedActUsagePolicy,
  type ActBudgetFailure,
  type ActBudgetReservationResult,
  type ActUsagePolicy,
} from './ActUsagePolicy'
import type { ActConversationRepository } from './ActConversationRepository'

export type {
  ActBudgetFailure,
  ActBudgetReservationResult,
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

  reserveForAttempt(...args: Parameters<ActUsagePolicy['reserveForAttempt']>) {
    return this.policy.reserveForAttempt(...args)
  }

  recordFinishedUsage(...args: Parameters<ActUsagePolicy['recordFinishedUsage']>) {
    return this.policy.recordFinishedUsage(...args)
  }

  releaseReservation(...args: Parameters<ActUsagePolicy['releaseReservation']>) {
    return this.policy.releaseReservation(...args)
  }

  markReservationForReconcile(...args: Parameters<ActUsagePolicy['markReservationForReconcile']>) {
    return this.policy.markReservationForReconcile(...args)
  }
}
