import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import { withSlackBot } from './client'
import { convertSlackEvents } from './convert'
import { normalizeSlackSyncEvent } from './normalize'

const options = { throwOnError: true } as const

/**
 * Live Slack events for linked channels. Called from the shared Slack webhook
 * after the signature check, outside the response, so Slack's 3-second
 * acknowledgement never waits on Convex. A failed write is recovered by the
 * history repair pass, so errors are logged rather than retried here.
 */
export async function handleSlackSyncEvent(body: string): Promise<void> {
  const change = normalizeSlackSyncEvent(body)
  if (!change) return
  const serverSecret = getInternalApiSecret()
  try {
    const link = await convex.query<{ status: string } | null>('sync/links:getLinkByChannel', {
      serverSecret, provider: 'slack', externalOrgId: change.teamId, externalChannelId: change.channelId,
    }, options)
    if (!link || link.status === 'paused') return
    const { events, authors } = await withSlackBot(change.teamId, async client => await convertSlackEvents(client, change.teamId, change.events, change.userIds))
    await convex.mutation('sync/ingest:applyInbound', {
      serverSecret,
      batch: { provider: 'slack', externalOrgId: change.teamId, externalChannelId: change.channelId, events, authors },
    }, options)
  } catch (error) {
    logger.warn('[sync/slack] live event was not applied', {
      teamId: change.teamId,
      channelId: change.channelId,
      error: summarizeErrorForLog(error),
    })
  }
}
