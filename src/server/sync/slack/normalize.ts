import type { SyncInboundEvent } from '@/shared/sync/types'

/** A Slack event reduced to sync events whose text is still Slack mrkdwn. */
export type SlackSyncEnvelope = {
  teamId: string
  channelId: string
  events: SyncInboundEvent[]
  userIds: string[]
}

type SlackMessage = {
  type?: string
  subtype?: string
  ts?: string
  thread_ts?: string
  user?: string
  bot_id?: string
  username?: string
  text?: string
  edited?: { ts?: string }
}

type SlackEvent = SlackMessage & {
  channel?: string
  message?: SlackMessage
  previous_message?: SlackMessage
  deleted_ts?: string
  reaction?: string
  item?: { type?: string; channel?: string; ts?: string }
}

type Envelope = {
  type?: string
  team_id?: string
  authorizations?: Array<{ team_id?: string }>
  event?: SlackEvent
}

const POSTED_SUBTYPES = new Set([undefined, 'thread_broadcast', 'file_share', 'bot_message', 'me_message'])

export function slackTsToMs(ts: string | undefined): number | undefined {
  if (!ts) return undefined
  const value = Number(ts)
  return Number.isFinite(value) ? Math.round(value * 1000) : undefined
}

function upsertFrom(message: SlackMessage, editedAt?: number): SyncInboundEvent | null {
  const externalUserId = message.user ?? message.bot_id
  const createdAt = slackTsToMs(message.ts)
  if (!message.ts || !externalUserId || createdAt === undefined) return null
  return {
    kind: 'message.upsert',
    externalMessageId: message.ts,
    ...(message.thread_ts && message.thread_ts !== message.ts ? { externalThreadId: message.thread_ts } : {}),
    externalUserId,
    text: message.text ?? '',
    createdAt,
    ...(editedAt !== undefined ? { editedAt } : {}),
  }
}

/**
 * Reads a raw Events API body and returns the sync change it carries, or null
 * for anything sync ignores (joins, topic changes, app events). Pure, so the
 * webhook path can reject unrelated events before any network call.
 */
export function normalizeSlackSyncEvent(body: string): SlackSyncEnvelope | null {
  let envelope: Envelope
  try {
    envelope = JSON.parse(body) as Envelope
  } catch (_error) {
    return null
  }
  const event = envelope?.type === 'event_callback' ? envelope.event : undefined
  const teamId = envelope?.team_id ?? envelope?.authorizations?.[0]?.team_id
  if (!event || !teamId) return null

  if (event.type === 'reaction_added' || event.type === 'reaction_removed') {
    if (event.item?.type !== 'message' || !event.item.channel || !event.item.ts || !event.user || !event.reaction) return null
    return {
      teamId,
      channelId: event.item.channel,
      events: [{
        kind: event.type === 'reaction_added' ? 'reaction.add' : 'reaction.remove',
        externalMessageId: event.item.ts,
        externalUserId: event.user,
        emoji: event.reaction,
      }],
      userIds: [event.user],
    }
  }

  if (event.type !== 'message' || !event.channel) return null
  if (event.subtype === 'message_deleted') {
    const ts = event.deleted_ts ?? event.previous_message?.ts
    return ts ? { teamId, channelId: event.channel, events: [{ kind: 'message.delete', externalMessageId: ts }], userIds: [] } : null
  }
  if (event.subtype === 'message_changed') {
    const message = event.message
    if (!message || message.subtype === 'tombstone') return null
    const upsert = upsertFrom(message, slackTsToMs(message.edited?.ts) ?? slackTsToMs(event.ts))
    return upsert ? { teamId, channelId: event.channel, events: [upsert], userIds: message.user ? [message.user] : [] } : null
  }
  if (!POSTED_SUBTYPES.has(event.subtype)) return null
  const upsert = upsertFrom(event)
  return upsert ? { teamId, channelId: event.channel, events: [upsert], userIds: event.user ? [event.user] : [] } : null
}

const USER_MENTION = /<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g

/** Slack user ids mentioned in mrkdwn, so their names can be resolved before conversion. */
export function slackMentionedUserIds(text: string): string[] {
  return [...text.matchAll(USER_MENTION)].map(match => match[1]!)
}

/**
 * Rewrites Slack's entity markup into readable text before the mrkdwn to
 * markdown conversion: user and channel mentions become @name and #name, and
 * broadcast mentions become @here, @channel and @everyone.
 */
export function expandSlackEntities(text: string, names: ReadonlyMap<string, string>): string {
  return text
    .replace(USER_MENTION, (_match, id: string, label?: string) => '@' + (names.get(id) ?? label ?? id))
    .replace(/<#([CG][A-Z0-9]+)\|([^>]*)>/g, (_match, id: string, name: string) => '#' + (name || id))
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, (_match, name: string) => '@' + name)
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, (_match, name: string) => name)
}
