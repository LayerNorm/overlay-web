import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { SyncChannelKind, SyncExternalAuthor, SyncInboundEvent } from '@/shared/sync/types'
import { teamsMessageToEvents, type TeamsChatMessage } from './convert'
import { graphRequest } from './graph'

/** The link fields Teams adapters need, satisfied by both SyncLinkRef and the sync/teamsLinks views. */
export type TeamsLinkTarget = {
  linkId: string
  externalOrgId: string
  externalGroupId?: string | null
  externalChannelId: string
  externalChannelKind?: SyncChannelKind
}

const options = { throwOnError: true } as const
const PROFILE_TTL_MS = 10 * 60 * 1000
const MAX_REPLY_PAGES = 5
const profiles = new Map<string, { author: SyncExternalAuthor; expiresAt: number }>()

export function teamsChannelPath(link: TeamsLinkTarget): string {
  if (!link.externalGroupId) throw new Error('Teams link has no team id')
  return '/teams/' + encodeURIComponent(link.externalGroupId) + '/channels/' + encodeURIComponent(link.externalChannelId)
}

/**
 * Adds email (and a fuller name) to Teams people so ingest can match them to
 * Overlay members. Uses the admin-consented User.ReadBasic.All grant; guests
 * from other tenants return 404 and keep the name Teams gave us.
 */
export async function resolveTeamsAuthors(token: string, tenantId: string, authors: SyncExternalAuthor[]): Promise<SyncExternalAuthor[]> {
  const resolved: SyncExternalAuthor[] = []
  for (const author of authors) {
    if (author.isBot) {
      resolved.push(author)
      continue
    }
    const key = tenantId + ':' + author.externalUserId
    const cached = profiles.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      resolved.push(cached.author)
      continue
    }
    const user = await graphRequest<{ displayName?: string; mail?: string | null; userPrincipalName?: string }>(
      token, '/users/' + encodeURIComponent(author.externalUserId) + '?$select=id,displayName,mail,userPrincipalName',
    ).catch((_error) => null)
    const email = user?.mail || (user?.userPrincipalName?.includes('#EXT#') ? undefined : user?.userPrincipalName)
    const enriched = {
      ...author,
      displayName: user?.displayName || author.displayName,
      ...(email ? { email } : {}),
    }
    profiles.set(key, { author: enriched, expiresAt: Date.now() + PROFILE_TTL_MS })
    resolved.push(enriched)
  }
  return resolved
}

/** A root post followed by all its replies, oldest reply first, following Graph's reply paging a few pages deep. */
export async function teamsThread(token: string, root: TeamsChatMessage): Promise<TeamsChatMessage[]> {
  const replies = [...(root.replies ?? [])]
  let next = root['replies@odata.nextLink']
  for (let page = 0; next && page < MAX_REPLY_PAGES; page += 1) {
    const result = await graphRequest<{ value?: TeamsChatMessage[]; '@odata.nextLink'?: string }>(token, next)
    replies.push(...(result.value ?? []))
    next = result['@odata.nextLink']
  }
  replies.sort((a, b) => Date.parse(a.createdDateTime ?? '') - Date.parse(b.createdDateTime ?? ''))
  return [root, ...replies.map(reply => ({ ...reply, replyToId: reply.replyToId ?? root.id }))]
}

/**
 * Converts Graph messages and applies them to the link's Overlay channel.
 * Graph reports a message's whole reaction set, so with withRemovals the
 * stored Teams reactions are diffed to remove the ones people took back.
 */
export async function applyTeamsMessages(
  link: TeamsLinkTarget,
  token: string,
  messages: TeamsChatMessage[],
  args: { withRemovals: boolean; extraEvents?: SyncInboundEvent[] },
): Promise<{ applied: number; skipped: number }> {
  const serverSecret = getInternalApiSecret()
  const events: SyncInboundEvent[] = [...(args.extraEvents ?? [])]
  const authors = new Map<string, SyncExternalAuthor>()
  for (const message of messages) {
    const converted = teamsMessageToEvents(message)
    for (const author of converted.authors) authors.set(author.externalUserId, author)
    events.push(...converted.events)
    const upsert = converted.events.find(event => event.kind === 'message.upsert')
    if (!args.withRemovals || !upsert) continue
    const stored = await convex.query<Array<{ externalUserId: string; emoji: string }>>('sync/teamsLinks:messageReactions', {
      serverSecret, externalChannelId: link.externalChannelId, externalMessageId: upsert.externalMessageId,
    }, options)
    const current = new Set(converted.events.flatMap(event => event.kind === 'reaction.add' ? [event.externalUserId + ' ' + event.emoji] : []))
    for (const reaction of stored ?? []) {
      if (current.has(reaction.externalUserId + ' ' + reaction.emoji)) continue
      events.push({ kind: 'reaction.remove', externalMessageId: upsert.externalMessageId, externalUserId: reaction.externalUserId, emoji: reaction.emoji })
    }
  }
  if (events.length === 0) return { applied: 0, skipped: 0 }
  const resolved = await resolveTeamsAuthors(token, link.externalOrgId, [...authors.values()])
  return await convex.mutation<{ applied: number; skipped: number }>('sync/ingest:applyInbound', {
    serverSecret,
    batch: { provider: 'teams', externalOrgId: link.externalOrgId, externalChannelId: link.externalChannelId, events, authors: resolved },
  }, options) ?? { applied: 0, skipped: events.length }
}
