import 'server-only'

import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import { withSlackBot } from './client'

/** Slack notices sync acts on besides channel messages: an Events API rate limit and a new public channel. */
export type SlackSyncNotice =
  | { kind: 'app_rate_limited'; teamId: string; catchUpUntil: number }
  | { kind: 'channel_created'; teamId: string; channelId: string; name: string }

type Envelope = {
  type?: string
  team_id?: string
  minute_rate_limited?: number
  authorizations?: Array<{ team_id?: string }>
  event?: { type?: string; channel?: { id?: string; name?: string; is_private?: boolean } }
}

/**
 * Reads an Events API body for the notices sync handles. Slack sends
 * app_rate_limited at the top level when it drops a workspace's events for
 * the rest of a minute; links catch up once that minute is over.
 */
export function parseSlackSyncNotice(body: string, now = Date.now()): SlackSyncNotice | null {
  let envelope: Envelope
  try {
    envelope = JSON.parse(body) as Envelope
  } catch (_error) {
    return null
  }
  const teamId = envelope?.team_id ?? envelope?.authorizations?.[0]?.team_id
  if (!teamId) return null
  if (envelope.type === 'app_rate_limited') {
    const minute = Number(envelope.minute_rate_limited)
    return { kind: 'app_rate_limited', teamId, catchUpUntil: Math.max(now + 60_000, Number.isFinite(minute) ? (minute + 60) * 1000 : 0) }
  }
  const channel = envelope.type === 'event_callback' && envelope.event?.type === 'channel_created' ? envelope.event.channel : undefined
  if (!channel?.id || !channel.name || channel.is_private || !channel.id.startsWith('C')) return null
  return { kind: 'channel_created', teamId, channelId: channel.id, name: channel.name }
}

/**
 * Applies a notice after the webhook has acknowledged it. A rate limit marks
 * the team's links Catching up; a new public channel is linked when the
 * connection has auto-link on, and Overlay joins it so its messages arrive.
 */
export async function handleSlackSyncNotice(
  notice: SlackSyncNotice,
  deps: { convex?: Pick<typeof lazyConvex, 'mutation'>; joinChannel?: (teamId: string, channelId: string) => Promise<void> } = {},
): Promise<void> {
  const convex = deps.convex ?? lazyConvex
  const serverSecret = getInternalApiSecret()
  try {
    if (notice.kind === 'app_rate_limited') {
      const marked = await convex.mutation<number>('sync/history:markCatchingUp', {
        serverSecret, provider: 'slack', externalOrgId: notice.teamId, catchUpUntil: notice.catchUpUntil,
      }, { throwOnError: true })
      logger.warn('[sync/slack] Slack rate-limited events; links are catching up', { teamId: notice.teamId, links: marked })
      return
    }
    const linked = await convex.mutation<{ linkId: string } | null>('sync/autoLink:channelCreated', {
      serverSecret, provider: 'slack', externalOrgId: notice.teamId, externalChannelId: notice.channelId, externalChannelName: notice.name,
    }, { throwOnError: true })
    if (!linked) return
    if (deps.joinChannel) await deps.joinChannel(notice.teamId, notice.channelId)
    else await withSlackBot(notice.teamId, async client => { await client.conversations.join({ channel: notice.channelId }) })
  } catch (error) {
    logger.warn('[sync/slack] notice was not applied', { kind: notice.kind, teamId: notice.teamId, error: summarizeErrorForLog(error) })
  }
}
