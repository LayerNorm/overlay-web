import 'server-only'

import type { SyncExternalAuthor, SyncInboundEvent } from '@/shared/sync/types'
import { SyncLinkPausedError, SyncRateLimitedError, type SyncHistoryAdapter, type SyncHistoryPage } from '../adapters'
import { SyncBudgetExhaustedError, acquireSyncBudget, reportSyncRateLimited, syncMethodBudget } from '../rate-limit'
import { SlackSyncUnavailableError, withSlackBot } from './client'
import { convertSlackEvents } from './convert'
import { slackHistoryMessageEvent, type SlackMessage } from './normalize'

type HistoryMessage = SlackMessage & { reply_count?: number }

type SlackHistoryResponse = {
  messages?: HistoryMessage[]
  has_more?: boolean
  response_metadata?: { next_cursor?: string }
}

/** Channel messages newest first back to oldest, then each thread's replies. Stored as the link's opaque cursor. */
type SlackHistoryCursor = {
  phase: 'messages' | 'replies'
  oldest: string
  cursor?: string
  threads: string[]
}

export type SlackApiCall = (method: string, params: Record<string, string | number>) => Promise<SlackHistoryResponse>

/** Slack errors that need someone to act before the channel can sync again. */
const PAUSING_ERRORS = new Set(['not_in_channel', 'channel_not_found', 'is_archived', 'missing_scope'])

/**
 * Calls one Slack Web API method with a bot token. Unlike the shared Chat SDK
 * client, which waits out 429s for up to half an hour, a 429 here surfaces at
 * once as SyncRateLimitedError so the worker can mark the link Catching up.
 */
export async function callSlackApi(
  token: string,
  method: string,
  params: Record<string, string | number>,
  fetchImpl: typeof fetch = fetch,
): Promise<SlackHistoryResponse> {
  const base = (process.env.SLACK_API_URL?.trim() || 'https://slack.com/api/').replace(/\/?$/, '/')
  const response = await fetchImpl(base + method, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])),
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'))
    throw new SyncRateLimitedError(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000)
  }
  const body = await response.json().catch((_error) => null) as (SlackHistoryResponse & { ok?: boolean; error?: string }) | null
  if (body?.ok) return body
  const code = body?.error ?? 'http_' + response.status
  if (code === 'ratelimited') throw new SyncRateLimitedError(60_000)
  if (PAUSING_ERRORS.has(code)) throw new SyncLinkPausedError(code)
  throw Object.assign(new Error('Slack ' + method + ' failed: ' + code), { data: { error: code } })
}

function slackTs(ms: number): string {
  return (ms / 1000).toFixed(6)
}

/**
 * Reads one page of a Slack channel's history for sync: newest-first channel
 * messages back to targetAt, collecting thread roots, then one thread's
 * replies per page. The phase, Slack's cursor and the pending threads travel
 * in the returned cursor, so a page can resume on any server.
 */
export async function readSlackHistoryPage(args: {
  call: SlackApiCall
  convert: (events: SyncInboundEvent[], userIds: string[]) => Promise<{ events: SyncInboundEvent[]; authors: SyncExternalAuthor[] }>
  channelId: string
  cursor?: string
  targetAt: number
  pageSize: number
}): Promise<SyncHistoryPage> {
  const state: SlackHistoryCursor = args.cursor
    ? JSON.parse(args.cursor) as SlackHistoryCursor
    : { phase: 'messages', oldest: slackTs(args.targetAt), threads: [] }
  let messages: HistoryMessage[]
  let after: SlackHistoryCursor | undefined
  let oldestAt: number | undefined
  if (state.phase === 'messages') {
    const result = await args.call('conversations.history', {
      channel: args.channelId, limit: args.pageSize, oldest: state.oldest, ...(state.cursor ? { cursor: state.cursor } : {}),
    })
    messages = result.messages ?? []
    const threads = [
      ...state.threads,
      ...messages.filter(message => message.ts && (message.reply_count ?? 0) > 0 && (!message.thread_ts || message.thread_ts === message.ts)).map(message => message.ts!),
    ]
    const next = result.has_more ? result.response_metadata?.next_cursor || undefined : undefined
    after = next
      ? { phase: 'messages', oldest: state.oldest, cursor: next, threads }
      : threads.length > 0 ? { phase: 'replies', oldest: state.oldest, threads } : undefined
    const times = messages.map(message => Number(message.ts) * 1000).filter(Number.isFinite)
    oldestAt = next ? (times.length > 0 ? Math.round(Math.min(...times)) : undefined) : Math.round(Number(state.oldest) * 1000)
  } else {
    const thread = state.threads[0]
    if (!thread) return { events: [], authors: [], done: true }
    let result: SlackHistoryResponse
    try {
      result = await args.call('conversations.replies', {
        channel: args.channelId, ts: thread, limit: args.pageSize, oldest: state.oldest, ...(state.cursor ? { cursor: state.cursor } : {}),
      })
    } catch (error) {
      if ((error as { data?: { error?: string } })?.data?.error !== 'thread_not_found') throw error
      result = {}
    }
    messages = (result.messages ?? []).filter(message => message.ts !== thread)
    const next = result.has_more ? result.response_metadata?.next_cursor || undefined : undefined
    after = next
      ? { ...state, cursor: next }
      : state.threads.length > 1 ? { phase: 'replies', oldest: state.oldest, threads: state.threads.slice(1) } : undefined
  }
  const events = messages.flatMap(message => slackHistoryMessageEvent(message) ?? [])
  const converted = events.length > 0
    ? await args.convert(events, messages.flatMap(message => message.user ? [message.user] : []))
    : { events: [], authors: [] }
  return {
    events: converted.events,
    authors: converted.authors,
    ...(after ? { nextCursor: JSON.stringify(after) } : {}),
    ...(oldestAt !== undefined ? { oldestAt } : {}),
    done: !after,
  }
}

/** Slack's history adapter: pages run under the workspace's bot token and the shared rate budget. */
export const slackHistoryAdapter: SyncHistoryAdapter = {
  provider: 'slack',
  async fetchHistoryPage(link, args) {
    const priority = args.priority ?? 'history'
    return await withSlackBot(link.externalOrgId, async client => {
      const token = client.token
      if (!token) throw new SlackSyncUnavailableError('The Slack installation token is missing')
      return await readSlackHistoryPage({
        call: async (method, params) => {
          const budget = await acquireSyncBudget({ provider: 'slack', externalOrgId: link.externalOrgId, method, priority })
          if (!budget.granted) throw new SyncBudgetExhaustedError(budget.waitMs)
          try {
            return await callSlackApi(token, method, params)
          } catch (error) {
            if (error instanceof SyncRateLimitedError) {
              await reportSyncRateLimited({ provider: 'slack', externalOrgId: link.externalOrgId, method, retryAfterMs: error.retryAfterMs })
            }
            throw error
          }
        },
        convert: async (events, userIds) => await convertSlackEvents(client, link.externalOrgId, events, userIds),
        channelId: link.externalChannelId,
        cursor: args.cursor,
        targetAt: args.targetAt,
        pageSize: syncMethodBudget('slack', 'conversations.history').pageSize,
      })
    })
  },
}
