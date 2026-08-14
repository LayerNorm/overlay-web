import 'server-only'

import { captureBusinessMetricRollup } from './metrics'

/**
 * Business metric rollup service.
 *
 * Aggregates per-window business metrics (active users, BFF invocations, chat
 * turns, automations, model cost) and emits them as a single rollup event to
 * PostHog.  Intended to be called periodically (e.g. every hour) from a
 * scheduled job or admin endpoint.
 *
 * The actual data sources are:
 * - Convex `dailyUsage` table for active users and chat/automation counts.
 * - Convex `tokenUsage` table for model cost.
 * - PostHog event counts for BFF invocations (queried via PostHog API).
 *
 * This module provides the emission contract; the caller is responsible for
 * gathering the raw numbers from the appropriate data source.
 */

export type BusinessRollupInput = {
  window: 'hourly' | 'daily'
  windowStart: number
  windowEnd: number
  activeUsers: number
  bffInvocations: number
  chatTurns: number
  automationsCompleted: number
  totalModelCostMicros: number
  totalInfraCostMicros: number
}

export function emitBusinessRollup(input: BusinessRollupInput): void {
  const costPerActiveUserMicros = input.activeUsers > 0
    ? Math.round(input.totalModelCostMicros / input.activeUsers)
    : 0
  const costPerChatTurnMicros = input.chatTurns > 0
    ? Math.round(input.totalModelCostMicros / input.chatTurns)
    : 0
  const costPerAutomationMicros = input.automationsCompleted > 0
    ? Math.round(input.totalModelCostMicros / input.automationsCompleted)
    : 0

  captureBusinessMetricRollup({
    window: input.window,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    activeUsers: input.activeUsers,
    bffInvocations: input.bffInvocations,
    chatTurns: input.chatTurns,
    automationsCompleted: input.automationsCompleted,
    totalModelCostMicros: input.totalModelCostMicros,
    totalInfraCostMicros: input.totalInfraCostMicros,
    costPerActiveUserMicros,
    costPerChatTurnMicros,
    costPerAutomationMicros,
  })
}
