import 'server-only'

import {
  BillingBackedActUsagePolicy,
  type ActBudgetFailure,
  type ActBudgetReservationResult,
  type ActUsagePolicy,
} from './ActUsagePolicy'
import type { ActConversationRepository } from './ActConversationRepository'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'

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
    if (isByokModelId(args[0].modelId)) {
      return Promise.resolve({ ok: true as const, reservationId: null })
    }
    return this.policy.reserveForAttempt(...args)
  }

  recordFinishedUsage(...args: Parameters<ActUsagePolicy['recordFinishedUsage']>) {
    if (isByokModelId(args[0].modelId)) {
      return Promise.resolve({ finalized: false, reservationId: null })
    }
    return this.policy.recordFinishedUsage(...args)
  }

  markReservationStarted(...args: Parameters<ActUsagePolicy['markReservationStarted']>) {
    return this.policy.markReservationStarted(...args)
  }

  releaseReservation(...args: Parameters<ActUsagePolicy['releaseReservation']>) {
    return this.policy.releaseReservation(...args)
  }

  markReservationForReconcile(...args: Parameters<ActUsagePolicy['markReservationForReconcile']>) {
    return this.policy.markReservationForReconcile(...args)
  }
}
