import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getBaseUrl } from '@/server/web/app-url'
import { TEAMS_APP_MISSING_REASONS } from '@/shared/sync/teams'
import type { SyncChannelKind, SyncLinkStatus } from '@/shared/sync/types'
import { GraphError, graphAppToken, graphRequest, isAppMissing } from './graph'
import { teamsChannelPath, type TeamsLinkTarget } from './messages'
import { teamsClientState } from './notifications'

/** Graph allows channel-message subscriptions just under 3 days; we ask for 70 hours and renew 12 hours ahead. */
const SUBSCRIPTION_LIFETIME_MS = 70 * 60 * 60 * 1000
const options = { throwOnError: true } as const

export type TeamsManagedLink = TeamsLinkTarget & {
  externalChannelKind: SyncChannelKind
  status: SyncLinkStatus
  subscriptionId?: string | null
  historyCompletedAt?: number | null
}

/** Where Graph delivers change and lifecycle notifications. MICROSOFT_SYNC_NOTIFICATION_BASE_URL points local development at a public tunnel. */
export function teamsNotificationUrl(): string {
  const base = process.env.MICROSOFT_SYNC_NOTIFICATION_BASE_URL?.trim() || getBaseUrl()
  return base.replace(/\/$/, '') + '/api/v1/webhooks/teams'
}

async function updateLink(linkId: string, patch: Record<string, unknown>) {
  await convex.mutation('sync/links:updateLinkState', { serverSecret: getInternalApiSecret(), linkId, ...patch }, options)
}

function resumedState(link: TeamsManagedLink) {
  return link.status === 'paused' ? { status: link.historyCompletedAt ? 'syncing' : 'history', pauseReason: null } : {}
}

/** Pauses a link with the fix the settings page shows, and forgets its subscription. */
export async function pauseTeamsLinkForMissingApp(link: TeamsManagedLink): Promise<void> {
  await updateLink(link.linkId, {
    status: 'paused',
    pauseReason: TEAMS_APP_MISSING_REASONS[link.externalChannelKind],
    subscriptionId: null,
    subscriptionExpiresAt: null,
  })
}

/**
 * Subscribes to a standard channel's messages and replies, without resource
 * data (we fetch each changed message), so no encryption certificate is
 * needed. Graph validates the notification URL during this call. A 403 or 404
 * means Overlay is not installed in the team, which pauses the link.
 */
export async function createTeamsSubscription(link: TeamsManagedLink): Promise<boolean> {
  const token = await graphAppToken(link.externalOrgId)
  const url = teamsNotificationUrl()
  try {
    const subscription = await graphRequest<{ id: string; expirationDateTime: string }>(token, '/subscriptions', {
      method: 'POST',
      body: {
        changeType: 'created,updated,deleted',
        notificationUrl: url,
        lifecycleNotificationUrl: url,
        resource: teamsChannelPath(link) + '/messages',
        includeResourceData: false,
        expirationDateTime: new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS).toISOString(),
        clientState: teamsClientState(link.linkId),
      },
    })
    await updateLink(link.linkId, {
      subscriptionId: subscription.id,
      subscriptionExpiresAt: Date.parse(subscription.expirationDateTime),
      ...resumedState(link),
    })
    return true
  } catch (error) {
    if (!isAppMissing(error)) throw error
    await pauseTeamsLinkForMissingApp(link)
    return false
  }
}

/** Extends a subscription; recreates it when Graph already dropped it. */
export async function renewTeamsSubscription(link: TeamsManagedLink): Promise<boolean> {
  if (!link.subscriptionId) return await createTeamsSubscription(link)
  const token = await graphAppToken(link.externalOrgId)
  try {
    const subscription = await graphRequest<{ expirationDateTime: string }>(token, '/subscriptions/' + encodeURIComponent(link.subscriptionId), {
      method: 'PATCH',
      body: { expirationDateTime: new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS).toISOString() },
    })
    await updateLink(link.linkId, { subscriptionExpiresAt: Date.parse(subscription.expirationDateTime) })
    return true
  } catch (error) {
    if (error instanceof GraphError && error.status === 404) return await createTeamsSubscription({ ...link, subscriptionId: null })
    if (!isAppMissing(error)) throw error
    await pauseTeamsLinkForMissingApp(link)
    return false
  }
}

/** Best-effort removal of a subscription nobody needs anymore (unlinked channel). Graph also expires it on its own. */
export async function deleteTeamsSubscription(tenantId: string, subscriptionId: string): Promise<void> {
  const token = await graphAppToken(tenantId)
  await graphRequest(token, '/subscriptions/' + encodeURIComponent(subscriptionId), { method: 'DELETE' }).catch((_error) => undefined)
}

/**
 * Checks whether a paused link can sync again. Standard channels resume by
 * subscribing; private and shared channels resume once a read succeeds, since
 * they are polled.
 */
export async function resumeTeamsLink(link: TeamsManagedLink): Promise<boolean> {
  if (link.externalChannelKind === 'public') return await createTeamsSubscription(link)
  const token = await graphAppToken(link.externalOrgId)
  try {
    await graphRequest(token, teamsChannelPath(link) + '/messages?$top=1')
  } catch (error) {
    if (!isAppMissing(error)) throw error
    await pauseTeamsLinkForMissingApp(link)
    return false
  }
  await updateLink(link.linkId, resumedState(link))
  return true
}
