import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import type { SyncInboundEvent } from '@/shared/sync/types'
import type { TeamsChatMessage } from './convert'
import { GraphError, graphAppToken, graphRequest, isAppMissing } from './graph'
import { applyTeamsMessages, teamsChannelPath, teamsThread } from './messages'
import { parseTeamsMessageResource, teamsResourceKey, type GraphNotification } from './notifications'
import {
  createTeamsSubscription,
  deleteTeamsSubscription,
  pauseTeamsLinkForMissingApp,
  renewTeamsSubscription,
  resumeTeamsLink,
  type TeamsManagedLink,
} from './subscriptions'

type TeamsLinkView = TeamsManagedLink & { workspaceId: string; lastEventAt: number | null }

const options = { throwOnError: true } as const
/** Polls re-read anything modified this long before the last applied change, covering clock skew and in-flight writes. */
const POLL_OVERLAP_MS = 2 * 60 * 1000
const POLL_PAGE_SIZE = 20
const MAINTENANCE_CONCURRENCY = 5

/**
 * Re-reads the newest posts of a channel (with replies) and applies anything
 * changed since the link's last event. Private and shared channels sync this
 * way because Graph refuses resource-specific-consent subscriptions on them;
 * standard channels use it to repair a 'missed' lifecycle notice.
 */
export async function pollTeamsLink(link: TeamsLinkView): Promise<number> {
  const token = await graphAppToken(link.externalOrgId)
  let page: { value?: TeamsChatMessage[] }
  try {
    page = await graphRequest(token, teamsChannelPath(link) + '/messages?$top=' + POLL_PAGE_SIZE + '&$expand=replies')
  } catch (error) {
    if (!isAppMissing(error)) throw error
    await pauseTeamsLinkForMissingApp(link)
    return 0
  }
  const since = (link.lastEventAt ?? 0) - POLL_OVERLAP_MS
  const changed: TeamsChatMessage[] = []
  for (const root of page.value ?? []) {
    for (const message of await teamsThread(token, root)) {
      if (Date.parse(message.lastModifiedDateTime ?? message.createdDateTime ?? '') >= since) changed.push(message)
    }
  }
  if (changed.length === 0) return 0
  return (await applyTeamsMessages(link, token, changed, { withRemovals: true })).applied
}

async function applyChangeNotifications(link: TeamsLinkView, items: GraphNotification[]) {
  const token = await graphAppToken(link.externalOrgId)
  const deletes: SyncInboundEvent[] = []
  const messages: TeamsChatMessage[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const resource = parseTeamsMessageResource(item.resource)
    if (!resource || resource.channelId !== link.externalChannelId) continue
    const key = teamsResourceKey(resource)
    if (seen.has(key + item.changeType)) continue
    seen.add(key + item.changeType)
    if (item.changeType === 'deleted') {
      deletes.push({ kind: 'message.delete', externalMessageId: key })
      continue
    }
    const path = teamsChannelPath(link) + '/messages/' + encodeURIComponent(resource.messageId)
      + (resource.replyId ? '/replies/' + encodeURIComponent(resource.replyId) : '')
    try {
      const message = await graphRequest<TeamsChatMessage>(token, path)
      messages.push(resource.replyId ? { ...message, replyToId: message.replyToId ?? resource.messageId } : message)
    } catch (error) {
      if (error instanceof GraphError && error.status === 404) {
        deletes.push({ kind: 'message.delete', externalMessageId: key })
        continue
      }
      if (error instanceof GraphError && error.status === 403) {
        await pauseTeamsLinkForMissingApp(link)
        return
      }
      throw error
    }
  }
  await applyTeamsMessages(link, token, messages, { withRemovals: true, extraEvents: deletes })
}

async function applyLifecycle(link: TeamsLinkView, event: string | undefined) {
  if (event === 'reauthorizationRequired') await renewTeamsSubscription(link)
  else if (event === 'subscriptionRemoved') await createTeamsSubscription({ ...link, subscriptionId: null })
  else if (event === 'missed') await pollTeamsLink(link)
}

/**
 * Applies verified Graph notifications, run after the webhook has answered.
 * Each item's clientState names its link; items from a subscription the link
 * no longer uses are ignored, and subscriptions for unlinked channels are
 * deleted. Change notifications carry no message data, so each changed message
 * is fetched with the tenant's app token.
 */
export async function handleTeamsNotifications(items: Array<GraphNotification & { linkId: string }>): Promise<void> {
  const serverSecret = getInternalApiSecret()
  const byLink = new Map<string, Array<GraphNotification & { linkId: string }>>()
  for (const item of items) byLink.set(item.linkId, [...(byLink.get(item.linkId) ?? []), item])
  for (const [linkId, linkItems] of byLink) {
    try {
      const link = await convex.query<TeamsLinkView | null>('sync/teamsLinks:getLink', { serverSecret, linkId }, options)
      if (!link) {
        for (const item of linkItems) {
          if (item.tenantId && item.subscriptionId) await deleteTeamsSubscription(item.tenantId, item.subscriptionId)
        }
        continue
      }
      const current = linkItems.filter(item => item.subscriptionId === link.subscriptionId)
      if (link.status === 'paused' || current.length === 0) continue
      for (const item of current.filter(entry => entry.lifecycleEvent)) await applyLifecycle(link, item.lifecycleEvent)
      const changes = current.filter(item => !item.lifecycleEvent)
      if (changes.length > 0) await applyChangeNotifications(link, changes)
    } catch (error) {
      logger.warn('[sync/teams] notification was not applied', { linkId, error: summarizeErrorForLog(error) })
    }
  }
}

/** One maintenance tick, called by the Convex cron through /api/v1/sync/teams/maintain. */
export async function runTeamsMaintenance(): Promise<Record<'subscribe' | 'renew' | 'poll' | 'retry', number>> {
  const due = await convex.query<Record<'subscribe' | 'renew' | 'poll' | 'retry', TeamsLinkView[]>>(
    'sync/teamsLinks:listMaintenance', { serverSecret: getInternalApiSecret() }, options,
  )
  const steps = { subscribe: createTeamsSubscription, renew: renewTeamsSubscription, poll: pollTeamsLink, retry: resumeTeamsLink }
  const work = (Object.keys(steps) as Array<keyof typeof steps>).flatMap(kind => (due?.[kind] ?? []).map(link => ({ kind, link, run: steps[kind] as (link: TeamsLinkView) => Promise<unknown> })))
  const done = { subscribe: 0, renew: 0, poll: 0, retry: 0 }
  for (let index = 0; index < work.length; index += MAINTENANCE_CONCURRENCY) {
    await Promise.all(work.slice(index, index + MAINTENANCE_CONCURRENCY).map(async ({ kind, link, run }) => {
      try {
        await run(link)
        done[kind] += 1
      } catch (error) {
        logger.warn('[sync/teams] maintenance step failed', { kind, linkId: link.linkId, error: summarizeErrorForLog(error) })
      }
    }))
  }
  return done
}
