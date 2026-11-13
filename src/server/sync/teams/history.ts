import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { SyncLinkPausedError, type SyncHistoryAdapter } from '@/server/sync/adapters'
import { TEAMS_APP_MISSING_REASONS } from '@/shared/sync/teams'
import type { SyncChannelKind, SyncExternalAuthor, SyncInboundEvent } from '@/shared/sync/types'
import { teamsMessageToEvents, type TeamsChatMessage } from './convert'
import { graphAppToken, graphRequest, isAppMissing } from './graph'
import { resolveTeamsAuthors, teamsChannelPath, teamsThread } from './messages'

const PAGE_SIZE = 50

/**
 * Teams history, newest first: each page is up to 50 channel posts with their
 * replies, read with the tenant's app token under the team's
 * ChannelMessage.Read.Group consent. The cursor is Graph's nextLink. Graph's
 * Retry-After becomes SyncRateLimitedError (in graphRequest); a missing app
 * becomes SyncLinkPausedError with the fix for the channel's kind.
 */
export const teamsHistoryAdapter: SyncHistoryAdapter = {
  provider: 'teams',
  async fetchHistoryPage(link, args) {
    const token = await graphAppToken(link.externalOrgId)
    let page: { value?: TeamsChatMessage[]; '@odata.nextLink'?: string }
    try {
      page = await graphRequest(token, args.cursor ?? teamsChannelPath(link) + '/messages?$top=' + PAGE_SIZE + '&$expand=replies')
    } catch (error) {
      if (!isAppMissing(error)) throw error
      const view = await convex.query<{ externalChannelKind: SyncChannelKind } | null>('sync/teamsLinks:getLink', {
        serverSecret: getInternalApiSecret(), linkId: link.linkId,
      }, { throwOnError: true })
      throw new SyncLinkPausedError(TEAMS_APP_MISSING_REASONS[view?.externalChannelKind ?? 'public'])
    }
    const roots = [...(page.value ?? [])].sort((a, b) => Date.parse(b.createdDateTime ?? '') - Date.parse(a.createdDateTime ?? ''))
    const events: SyncInboundEvent[] = []
    const authors = new Map<string, SyncExternalAuthor>()
    let oldestAt: number | undefined
    let reachedTarget = false
    for (const root of roots) {
      const createdAt = Date.parse(root.createdDateTime ?? '')
      if (!Number.isFinite(createdAt) || createdAt < args.targetAt) {
        reachedTarget = true
        continue
      }
      oldestAt = Math.min(oldestAt ?? createdAt, createdAt)
      for (const message of await teamsThread(token, root)) {
        const converted = teamsMessageToEvents(message)
        events.push(...converted.events)
        for (const author of converted.authors) authors.set(author.externalUserId, author)
      }
    }
    const nextCursor = reachedTarget ? undefined : page['@odata.nextLink']
    return {
      events,
      authors: await resolveTeamsAuthors(token, link.externalOrgId, [...authors.values()]),
      ...(nextCursor ? { nextCursor } : {}),
      ...(oldestAt !== undefined ? { oldestAt } : {}),
      done: !nextCursor,
    }
  },
}
