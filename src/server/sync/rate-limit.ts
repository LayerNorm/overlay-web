import 'server-only'

import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { SyncProvider } from '@/shared/sync/types'

/**
 * One token bucket per provider, external org and method, shared by every
 * worker (live, outbound, repair, history) through sync/rateBudgets. Slack
 * limits are per method, per workspace, per app, so every token we hold in a
 * workspace draws from the same bucket.
 */

export type SyncWorkPriority = 'live' | 'outbound' | 'repair' | 'history'

export type SyncMethodBudget = { capacity: number; refillPerMinute: number; pageSize: number }

type ConvexCaller = Pick<typeof lazyConvex, 'mutation'>

const SLACK_HISTORY_METHODS = new Set(['conversations.history', 'conversations.replies'])

/** Our local bucket is empty; try again later. Distinct from the platform's own 429. */
export class SyncBudgetExhaustedError extends Error {
  constructor(readonly waitMs: number) {
    super('Sync rate budget exhausted')
  }
}

/**
 * Slack keeps non-Marketplace commercial apps at 1 history or replies call a
 * minute with 15 messages a page. Set SLACK_SYNC_MARKETPLACE_APPROVED=true once
 * the Overlay app is approved in the Slack Marketplace to switch to Tier 3.
 */
export function slackMarketplaceApproved(): boolean {
  return process.env.SLACK_SYNC_MARKETPLACE_APPROVED?.trim() === 'true'
}

export function syncMethodBudget(provider: SyncProvider, method: string): SyncMethodBudget {
  if (provider === 'slack' && SLACK_HISTORY_METHODS.has(method)) {
    return slackMarketplaceApproved()
      ? { capacity: 10, refillPerMinute: 50, pageSize: 1000 }
      : { capacity: 1, refillPerMinute: 1, pageSize: 15 }
  }
  return { capacity: 20, refillPerMinute: 50, pageSize: 200 }
}

export function syncBudgetKey(provider: SyncProvider, externalOrgId: string, method: string): string {
  return provider + ':' + externalOrgId + ':' + method
}

/** Takes one call from the shared budget. Returns whether it was granted and how long to wait if not. */
export async function acquireSyncBudget(
  args: { provider: SyncProvider; externalOrgId: string; method: string; priority: SyncWorkPriority; cost?: number },
  convex: ConvexCaller = lazyConvex,
): Promise<{ granted: boolean; waitMs: number }> {
  const budget = syncMethodBudget(args.provider, args.method)
  const result = await convex.mutation<{ granted: boolean; waitMs: number }>('sync/rateBudgets:take', {
    serverSecret: getInternalApiSecret(),
    key: syncBudgetKey(args.provider, args.externalOrgId, args.method),
    capacity: budget.capacity,
    refillPerMinute: budget.refillPerMinute,
    priority: args.priority,
    ...(args.cost !== undefined ? { cost: args.cost } : {}),
  }, { throwOnError: true })
  return result ?? { granted: false, waitMs: 60_000 }
}

/** Records a platform Retry-After so every worker waits it out. */
export async function reportSyncRateLimited(
  args: { provider: SyncProvider; externalOrgId: string; method: string; retryAfterMs: number },
  convex: ConvexCaller = lazyConvex,
): Promise<void> {
  const budget = syncMethodBudget(args.provider, args.method)
  await convex.mutation('sync/rateBudgets:block', {
    serverSecret: getInternalApiSecret(),
    key: syncBudgetKey(args.provider, args.externalOrgId, args.method),
    capacity: budget.capacity,
    refillPerMinute: budget.refillPerMinute,
    retryAfterMs: args.retryAfterMs,
  }, { throwOnError: true })
}
