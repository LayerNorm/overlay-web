import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import type { SyncProvider } from '@/shared/sync/types'
import {
  SyncAccountRevokedError,
  SyncLinkPausedError,
  SyncOutboundRejectedError,
  SyncRateLimitedError,
  type SyncLinkRef,
  type SyncOutboundAdapter,
} from './adapters'
import { slackOutboundAdapter } from './slack/outbound'
import { openSyncToken } from './token-seal'

/** Outbound adapters by provider. Teams registers its adapter here. */
export const SYNC_OUTBOUND_ADAPTERS: Partial<Record<SyncProvider, SyncOutboundAdapter>> = {
  slack: slackOutboundAdapter,
}

/** One claimed sync/outbox row, as returned by sync/outbox:claimDue. */
export type SyncOutboxWork = {
  outboxId: string
  action: 'post' | 'edit' | 'delete' | 'react' | 'unreact'
  emoji?: string
  attempts: number
  link: SyncLinkRef
  externalUserId: string
  sealedToken: string
  content: string
  externalThreadId?: string
  externalMessageId?: string
}

export type SyncOutboxRelease = {
  outboxId: string
  error: string
  retryAfterMs?: number
  permanent?: boolean
  refundAttempt?: boolean
  revokeAccount?: boolean
}

export type SyncOutboxStore = {
  claimDue(limit: number): Promise<SyncOutboxWork[]>
  complete(args: { outboxId: string; externalMessageId?: string; externalThreadId?: string }): Promise<void>
  release(args: SyncOutboxRelease): Promise<void>
}

const options = { throwOnError: true } as const

function convexStore(): SyncOutboxStore {
  const serverSecret = getInternalApiSecret()
  return {
    claimDue: async limit => await convex.mutation<SyncOutboxWork[]>('sync/outbox:claimDue', { serverSecret, limit }, options) ?? [],
    complete: async args => { await convex.mutation('sync/outbox:complete', { serverSecret, ...args }, options) },
    release: async args => { await convex.mutation('sync/outbox:release', { serverSecret, ...args }, options) },
  }
}

/** Maps an adapter failure to how the row is released; tokens and message text never reach the reason. */
export function outboundFailure(error: unknown): Omit<SyncOutboxRelease, 'outboxId'> {
  if (error instanceof SyncRateLimitedError) return { error: 'Rate limited; retrying', retryAfterMs: error.retryAfterMs, refundAttempt: true }
  if (error instanceof SyncAccountRevokedError) return { error: 'Your account connection stopped working. Reconnect it to send.', permanent: true, revokeAccount: true }
  if (error instanceof SyncOutboundRejectedError || error instanceof SyncLinkPausedError) return { error: error.message, permanent: true }
  return { error: error instanceof Error ? error.message : 'Send failed' }
}

/**
 * Sends due outbox rows with each author's own account, oldest first, until
 * the queue is empty or the time budget runs out. Rows are processed one at a
 * time so a member's messages reach the platform in the order they were sent.
 */
export async function runSyncOutbound(args: {
  store?: SyncOutboxStore
  adapters?: Partial<Record<SyncProvider, SyncOutboundAdapter>>
  budgetMs?: number
} = {}): Promise<{ sent: number; failed: number }> {
  const store = args.store ?? convexStore()
  const adapters = args.adapters ?? SYNC_OUTBOUND_ADAPTERS
  const deadline = Date.now() + (args.budgetMs ?? 45_000)
  let sent = 0
  let failed = 0
  while (Date.now() < deadline) {
    const work = await store.claimDue(10)
    if (work.length === 0) break
    for (const item of work) {
      const adapter = adapters[item.link.provider]
      try {
        if (!adapter) throw new SyncOutboundRejectedError('Sending to ' + item.link.provider + ' is not available yet')
        const credential = { externalUserId: item.externalUserId, accessToken: openSyncToken(item.sealedToken) }
        const message = { content: item.content, ...(item.externalThreadId ? { externalThreadId: item.externalThreadId } : {}) }
        if (item.action === 'post') {
          const { externalMessageId } = await adapter.post(item.link, credential, message)
          const completion = { outboxId: item.outboxId, externalMessageId, ...(item.externalThreadId ? { externalThreadId: item.externalThreadId } : {}) }
          await store.complete(completion).catch(async (_error) => await store.complete(completion))
          sent += 1
          continue
        }
        if (!item.externalMessageId) throw new Error('The platform message id is missing')
        if (item.action === 'edit') await adapter.edit(item.link, credential, item.externalMessageId, message)
        else if (item.action === 'delete') await adapter.remove(item.link, credential, item.externalMessageId)
        else await adapter.react(item.link, credential, item.externalMessageId, item.emoji ?? '', item.action === 'react')
        await store.complete({ outboxId: item.outboxId })
        sent += 1
      } catch (error) {
        failed += 1
        logger.warn('[sync/outbound] send failed', {
          provider: item.link.provider,
          linkId: item.link.linkId,
          action: item.action,
          attempts: item.attempts,
          error: summarizeErrorForLog(error),
        })
        await store.release({ outboxId: item.outboxId, ...outboundFailure(error) })
      }
    }
  }
  return { sent, failed }
}
