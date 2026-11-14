import 'server-only'

import type { SyncExternalAuthor, SyncInboundEvent } from '@/shared/sync/types'
import type { SlackWebClient } from './client'
import { expandSlackEntities, slackMentionedUserIds } from './normalize'

const PROFILE_TTL_MS = 10 * 60 * 1000
const profiles = new Map<string, { author: SyncExternalAuthor; expiresAt: number }>()

type SlackUser = {
  id?: string
  name?: string
  real_name?: string
  is_bot?: boolean
  profile?: { display_name?: string; real_name?: string; email?: string; image_72?: string }
}

/** Resolves Slack people to sync authors, cached briefly per team so busy channels do not call users.info per message. */
export async function resolveSlackAuthors(client: SlackWebClient, teamId: string, userIds: Iterable<string>): Promise<SyncExternalAuthor[]> {
  const authors: SyncExternalAuthor[] = []
  for (const userId of new Set(userIds)) {
    const key = teamId + ':' + userId
    const cached = profiles.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      authors.push(cached.author)
      continue
    }
    let author: SyncExternalAuthor
    if (userId.startsWith('B')) {
      const bot = await client.bots.info({ bot: userId }).catch((_error) => null)
      author = { externalUserId: userId, displayName: bot?.bot?.name ?? 'Bot', isBot: true, ...(bot?.bot?.icons?.image_72 ? { avatarUrl: bot.bot.icons.image_72 } : {}) }
    } else {
      const result = await client.users.info({ user: userId }).catch((_error) => null)
      const user = result?.user as SlackUser | undefined
      const displayName = user?.profile?.display_name || user?.profile?.real_name || user?.real_name || user?.name || userId
      author = {
        externalUserId: userId,
        displayName,
        ...(user?.profile?.email ? { email: user.profile.email } : {}),
        ...(user?.profile?.image_72 ? { avatarUrl: user.profile.image_72 } : {}),
        ...(user?.is_bot ? { isBot: true } : {}),
      }
    }
    profiles.set(key, { author, expiresAt: Date.now() + PROFILE_TTL_MS })
    authors.push(author)
  }
  return authors
}

let shortcodes: Promise<(name: string) => string | undefined> | undefined

/** Slack reactions arrive as shortcodes (tada, +1, thumbsup::skin-tone-2); Overlay stores the emoji itself. */
export async function slackReactionToEmoji(name: string): Promise<string> {
  shortcodes ??= import('@tiptap/extension-emoji').then(({ gitHubEmojis, shortcodeToEmoji }) => (code: string) => shortcodeToEmoji(code, gitHubEmojis)?.emoji)
  const base = name.split('::')[0]!
  const lookup = await shortcodes
  return lookup(base) ?? lookup(base === '+1' ? 'thumbsup' : base === '-1' ? 'thumbsdown' : base) ?? ':' + base + ':'
}

let converter: Promise<{ toAst(text: string): unknown; fromAst(ast: unknown): string }> | undefined

/** Turns Slack mrkdwn into Overlay markdown and Slack reaction names into emoji, after names are resolved. */
export async function convertSlackEvents(
  client: SlackWebClient,
  teamId: string,
  events: SyncInboundEvent[],
  userIds: string[],
): Promise<{ events: SyncInboundEvent[]; authors: SyncExternalAuthor[] }> {
  const mentioned = events.flatMap(event => event.kind === 'message.upsert' ? slackMentionedUserIds(event.text) : [])
  const people = await resolveSlackAuthors(client, teamId, [
    ...userIds,
    ...events.flatMap(event => event.kind === 'message.delete' ? [] : [event.externalUserId]),
    ...mentioned,
  ])
  const names = new Map(people.map(person => [person.externalUserId, person.displayName]))
  converter ??= import('@chat-adapter/slack').then(({ SlackFormatConverter }) => new SlackFormatConverter() as never)
  const format = await converter
  const converted: SyncInboundEvent[] = []
  for (const event of events) {
    if (event.kind === 'message.upsert') {
      converted.push({ ...event, text: format.fromAst(format.toAst(expandSlackEntities(event.text, names))).trim() })
    } else if (event.kind === 'message.delete') {
      converted.push(event)
    } else {
      converted.push({ ...event, emoji: await slackReactionToEmoji(event.emoji) })
    }
  }
  const authorIds = new Set(converted.flatMap(event => event.kind === 'message.delete' ? [] : [event.externalUserId]))
  return { events: converted, authors: people.filter(person => authorIds.has(person.externalUserId)) }
}
