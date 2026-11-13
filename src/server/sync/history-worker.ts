import 'server-only'

import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import { SYNC_HISTORY_WINDOW_MS, type SyncInboundEvent, type SyncProvider } from '@/shared/sync/types'
import { SyncLinkPausedError, SyncRateLimitedError, type SyncHistoryAdapter, type SyncLinkRef } from './adapters'
import { SyncBudgetExhaustedError } from './rate-limit'
import { slackHistoryAdapter } from './slack/history'

/** One line per provider. */
const HISTORY_ADAPTERS: Partial<Record<SyncProvider, SyncHistoryAdapter>> = {
  slack: slackHistoryAdapter,
}

/** Gap repair compares this much recent platform history with what we stored. */
export const SYNC_REPAIR_WINDOW_MS = 24 * 60 * 60 * 1000

const MAX_BACKFILL_WORKSPACES = 8
const MAX_PAGES_PER_LINK = 25
const APPLY_CHUNK = 100
const LEASE_MS = 3 * 60_000
const TICK_MS = 45_000

export type SyncHistoryWork = {
  mode: 'history' | 'repair'
  link: SyncLinkRef & { historyTargetAt?: number; historyOldestAt?: number; historyCursor?: string; repairCursor?: string }
}

type Deps = {
  convex: Pick<typeof lazyConvex, 'mutation'>
  adapters: Partial<Record<SyncProvider, SyncHistoryAdapter>>
  now: () => number
}

const options = { throwOnError: true } as const

/**
 * One bounded pass of history import and gap repair, run by the Convex cron
 * through /api/v1/sync/history/process. Convex leases at most one link per
 * workspace; each link pages until its budget, the page cap or the deadline
 * runs out. Every write goes through sync/ingest:applyInbound, keyed by the
 * platform message id, so overlap with live events never duplicates.
 */
export async function runSyncHistoryTick(input: Partial<Deps> & { deadlineAt?: number } = {}): Promise<{ links: number; pages: number }> {
  const convex = input.convex ?? lazyConvex
  const adapters = input.adapters ?? HISTORY_ADAPTERS
  const now = input.now ?? Date.now
  const deadlineAt = input.deadlineAt ?? now() + TICK_MS
  const serverSecret = getInternalApiSecret()
  const work = await convex.mutation<SyncHistoryWork[]>('sync/history:claimWork', {
    serverSecret, maxWorkspaces: MAX_BACKFILL_WORKSPACES, leaseMs: LEASE_MS,
  }, options) ?? []
  const pages = await Promise.all(work.map(async ({ mode, link }) => {
    const { historyTargetAt, historyOldestAt, historyCursor, repairCursor, ...ref } = link
    const adapter = adapters[link.provider]
    const updateWork = async (fields: Record<string, unknown>) => await convex.mutation('sync/history:updateWork', { serverSecret, linkId: link.linkId, ...fields }, options)
    const updateLinkState = async (fields: Record<string, unknown>) => await convex.mutation('sync/links:updateLinkState', { serverSecret, linkId: link.linkId, ...fields }, options)
    const targetAt = mode === 'history' ? historyTargetAt ?? now() - SYNC_HISTORY_WINDOW_MS : now() - SYNC_REPAIR_WINDOW_MS
    let cursor = mode === 'history' ? historyCursor : repairCursor
    let oldestAt = historyOldestAt
    let count = 0
    try {
      while (adapter && count < MAX_PAGES_PER_LINK && now() < deadlineAt) {
        const page = await adapter.fetchHistoryPage(ref, { ...(cursor ? { cursor } : {}), targetAt, priority: mode })
        count += 1
        let events: SyncInboundEvent[] = page.events
        if (mode === 'repair') {
          const ids = events.flatMap(event => event.kind === 'message.upsert' ? [event.externalMessageId] : [])
          const mapped = new Set(ids.length > 0
            ? await convex.mutation<string[]>('sync/ingest:isMapped', {
                serverSecret, provider: link.provider, externalChannelId: link.externalChannelId, externalMessageIds: ids,
              }, options)
            : [])
          events = events.filter(event => event.kind !== 'message.upsert' || !mapped.has(event.externalMessageId) || event.editedAt !== undefined)
        }
        for (let start = 0; start < events.length; start += APPLY_CHUNK) {
          const chunk = events.slice(start, start + APPLY_CHUNK)
          const people = new Set(chunk.flatMap(event => event.kind === 'message.delete' ? [] : [event.externalUserId]))
          await convex.mutation('sync/ingest:applyInbound', {
            serverSecret,
            batch: {
              provider: link.provider,
              externalOrgId: link.externalOrgId,
              externalChannelId: link.externalChannelId,
              events: chunk,
              authors: page.authors.filter(author => people.has(author.externalUserId)),
            },
          }, options)
        }
        const finished = page.done || !page.nextCursor
        if (mode === 'history') {
          if (page.oldestAt !== undefined) oldestAt = Math.min(oldestAt ?? page.oldestAt, page.oldestAt)
          await updateLinkState({
            historyCursor: finished ? null : page.nextCursor,
            ...(oldestAt !== undefined ? { historyOldestAt: oldestAt } : {}),
            ...(finished ? { historyCompletedAt: now() } : {}),
          })
          if (finished) await updateWork({ completeHistory: true })
        } else {
          await updateWork(finished ? { repairCursor: null, repairedAt: now() } : { repairCursor: page.nextCursor })
        }
        if (finished) break
        cursor = page.nextCursor
      }
    } catch (error) {
      if (error instanceof SyncRateLimitedError) {
        await updateLinkState({ status: 'catching_up', catchUpUntil: now() + error.retryAfterMs })
      } else if (error instanceof SyncLinkPausedError) {
        await updateLinkState({ status: 'paused', pauseReason: error.reason })
      } else if (!(error instanceof SyncBudgetExhaustedError)) {
        logger.warn('[sync/history] link work stopped', {
          linkId: link.linkId, provider: link.provider, mode, error: summarizeErrorForLog(error),
        })
      }
    } finally {
      await updateWork({ release: true }).catch((error: unknown) => {
        logger.warn('[sync/history] lease release failed', { linkId: link.linkId, error: summarizeErrorForLog(error) })
      })
    }
    return count
  }))
  return { links: work.length, pages: pages.reduce((sum, count) => sum + count, 0) }
}
