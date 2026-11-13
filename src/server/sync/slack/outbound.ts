import 'server-only'

import {
  SyncAccountRevokedError,
  SyncOutboundRejectedError,
  SyncRateLimitedError,
  type SyncOutboundAdapter,
} from '@/server/sync/adapters'
import { slackReplyPayload } from '@/server/surfaces/slack-reply'

const REVOKED = new Set(['invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive', 'missing_scope', 'no_permission'])
const REJECTED = new Set([
  'channel_not_found', 'not_in_channel', 'is_archived', 'restricted_action', 'cant_update_message', 'cant_delete_message',
  'edit_window_closed', 'msg_too_long', 'no_text', 'invalid_name', 'too_many_emoji', 'too_many_reactions', 'thread_not_found',
])

/**
 * Calls one Slack Web API method with a member's user token. Slack answers
 * HTTP 200 with `ok: false` for most failures, so errors are classified here:
 * a revoked grant, a refusal retrying can't fix, or a rate limit to wait out.
 */
async function callSlack(token: string, method: string, body: Record<string, unknown>, tolerated: string[] = []): Promise<{ ts?: string }> {
  const response = await fetch('https://slack.com/api/' + method, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  if (response.status === 429) throw new SyncRateLimitedError(Number(response.headers.get('retry-after') ?? 30) * 1000)
  if (!response.ok) throw new Error('Slack ' + method + ' failed with HTTP ' + response.status)
  const result = await response.json() as { ok?: boolean; error?: string; ts?: string }
  if (result.ok || tolerated.includes(result.error ?? '')) return result
  const error = result.error ?? 'unknown_error'
  if (error === 'ratelimited') throw new SyncRateLimitedError(30_000)
  if (REVOKED.has(error)) throw new SyncAccountRevokedError('Slack rejected the member token: ' + error)
  if (REJECTED.has(error)) throw new SyncOutboundRejectedError('Slack refused ' + method + ': ' + error)
  throw new Error('Slack ' + method + ' failed: ' + error)
}

let emojiNames: Promise<Map<string, string>> | undefined

/** Overlay stores reactions as emoji; Slack takes names. Custom Slack emoji arrive as :name: and go back unchanged. */
export async function slackReactionName(emoji: string): Promise<string> {
  const custom = /^:([a-z0-9_+'-]+):$/i.exec(emoji)
  if (custom) return custom[1]!
  emojiNames ??= import('@tiptap/extension-emoji').then(({ gitHubEmojis }) => new Map(
    gitHubEmojis.flatMap(entry => entry.emoji ? [[entry.emoji, entry.name] as const, [entry.emoji.replace(/\uFE0F/g, ''), entry.name] as const] : []),
  ))
  const name = (await emojiNames).get(emoji) ?? (await emojiNames).get(emoji.replace(/\uFE0F/g, ''))
  if (!name) throw new SyncOutboundRejectedError('Slack has no reaction for ' + emoji)
  return name
}

/** Posts, edits, deletes and reacts in Slack as the member, using their own user token. */
export const slackOutboundAdapter: SyncOutboundAdapter = {
  provider: 'slack',
  async post(link, credential, message) {
    const result = await callSlack(credential.accessToken, 'chat.postMessage', {
      channel: link.externalChannelId,
      ...(message.externalThreadId ? { thread_ts: message.externalThreadId } : {}),
      ...await slackReplyPayload(message.content),
      unfurl_links: false,
      unfurl_media: false,
    })
    if (!result.ts) throw new Error('Slack chat.postMessage returned no ts')
    return { externalMessageId: result.ts }
  },
  async edit(link, credential, externalMessageId, message) {
    await callSlack(credential.accessToken, 'chat.update', { channel: link.externalChannelId, ts: externalMessageId, ...await slackReplyPayload(message.content) })
  },
  async remove(link, credential, externalMessageId) {
    await callSlack(credential.accessToken, 'chat.delete', { channel: link.externalChannelId, ts: externalMessageId }, ['message_not_found'])
  },
  async react(link, credential, externalMessageId, emoji, enabled) {
    await callSlack(
      credential.accessToken,
      enabled ? 'reactions.add' : 'reactions.remove',
      { channel: link.externalChannelId, timestamp: externalMessageId, name: await slackReactionName(emoji) },
      [enabled ? 'already_reacted' : 'no_reaction'],
    )
  },
}
