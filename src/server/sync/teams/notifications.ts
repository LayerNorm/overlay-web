import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { teamsMessageKey } from '@/shared/sync/teams'

/** One item from a Graph change or lifecycle notification body. */
export type GraphNotification = {
  subscriptionId?: string
  clientState?: string
  changeType?: string
  resource?: string
  tenantId?: string
  lifecycleEvent?: 'reauthorizationRequired' | 'subscriptionRemoved' | 'missed' | string
}

export type TeamsMessageResource = {
  teamId: string
  channelId: string
  messageId: string
  replyId?: string
}

function sign(linkId: string): string {
  return createHmac('sha256', getInternalApiSecret()).update('overlay-teams-client-state:v1:' + linkId).digest('base64url')
}

/** The clientState a link's subscription carries: the link id plus an HMAC, so notifications are verified and routed without a lookup. */
export function teamsClientState(linkId: string): string {
  return linkId + '.' + sign(linkId)
}

/** Returns the link id a clientState was minted for, or null when it was not signed by us. */
export function openTeamsClientState(value: string | undefined): string | null {
  if (!value) return null
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null
  const linkId = value.slice(0, separator)
  const provided = Buffer.from(value.slice(separator + 1))
  const expected = Buffer.from(sign(linkId))
  return provided.length === expected.length && timingSafeEqual(provided, expected) ? linkId : null
}

const RESOURCE = /^\/?teams\('([^']+)'\)\/channels\('([^']+)'\)\/messages\('([^']+)'\)(?:\/replies\('([^']+)'\))?$/

/** Parses a notification's resource path, e.g. teams('t')/channels('c')/messages('m')/replies('r'). */
export function parseTeamsMessageResource(resource: string | undefined): TeamsMessageResource | null {
  const match = resource ? RESOURCE.exec(resource) : null
  if (!match) return null
  return { teamId: match[1]!, channelId: match[2]!, messageId: match[3]!, ...(match[4] ? { replyId: match[4] } : {}) }
}

export function teamsResourceKey(resource: TeamsMessageResource): string {
  return resource.replyId ? teamsMessageKey(resource.replyId, resource.messageId) : resource.messageId
}

/** Reads a notification POST body and keeps only items whose clientState we signed, paired with their link id. */
export function verifiedTeamsNotifications(body: string): Array<GraphNotification & { linkId: string }> {
  let parsed: { value?: GraphNotification[] }
  try {
    parsed = JSON.parse(body) as { value?: GraphNotification[] }
  } catch (_error) {
    return []
  }
  if (!Array.isArray(parsed?.value)) return []
  return parsed.value.flatMap(item => {
    const linkId = openTeamsClientState(item?.clientState)
    return linkId && item.subscriptionId ? [{ ...item, linkId }] : []
  })
}
