import 'server-only'

import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import type { SlackAdapter } from '@chat-adapter/slack'
import { degradeSlackConnectionByTeam, isSlackTokenRevokedError } from './slack-lifecycle'

// Slack rejects messages over ~40k chars; keep well under with headroom for
// markdown expansion.
const SLACK_MESSAGE_CHAR_LIMIT = 38_000
// `markdown_text` (Slack-rendered standard markdown) is capped at 12k chars.
const SLACK_MARKDOWN_TEXT_CHAR_LIMIT = 12_000

export function truncateForSlack(text: string): string {
  if (text.length <= SLACK_MESSAGE_CHAR_LIMIT) return text
  return `${text.slice(0, SLACK_MESSAGE_CHAR_LIMIT - 20).trimEnd()}\n\n…`
}

/**
 * Agent replies are standard markdown; Slack renders it natively through
 * `markdown_text`, which is how the Chat SDK posts markdown too. Replies over
 * Slack's 12k `markdown_text` cap fall back to legacy mrkdwn in `text`.
 * The SDK loads dynamically so workflow bundles never resolve it (chat.ts).
 */
// The Slack app's own name. Slack shows it as the sender of every reply (it
// ignores the per-message `username` override for this app), so replies from
// any other agent open with the agent's name.
const SLACK_APP_NAME = 'Overlay'

export function withAgentAttribution(text: string, agentName: string): string {
  const name = agentName.trim()
  if (!name || name.toLowerCase() === SLACK_APP_NAME.toLowerCase()) return text
  return `**${name}**\n\n${text}`
}

export async function slackReplyPayload(markdown: string): Promise<{ markdown_text: string } | { text: string }> {
  const { SlackFormatConverter } = await import('@chat-adapter/slack')
  const converter = new SlackFormatConverter()
  if (markdown.length <= SLACK_MARKDOWN_TEXT_CHAR_LIMIT) {
    const payload = converter.toSlackPayload({ markdown })
    if ('markdown_text' in payload && typeof payload.markdown_text === 'string') {
      return { markdown_text: payload.markdown_text }
    }
  }
  return { text: truncateForSlack(converter.toResponseUrlText({ markdown })) }
}

/**
 * Post (or edit the "working" placeholder into) the agent's reply on Slack.
 * Runs under the installation's bot token — outside webhook request context
 * `adapter.webClient` cannot resolve a token, so the token is pulled from the
 * Chat SDK state adapter and scoped via `withBotToken`.
 *
 * `username` gives the agent its own display name (chat:write.customize).
 * Returns the posted/edited message ts, or null when nothing was sent.
 */
export async function postSlackAgentMessage(args: {
  adapter: SlackAdapter
  teamId: string
  channelId: string
  threadTs?: string
  text: string
  agentName: string
  /** When set, edit this existing message instead of posting a new one. */
  editTs?: string
}): Promise<{ ts?: string; posted: boolean }> {
  const installation = await args.adapter.getInstallation(args.teamId)
  if (!installation?.botToken) {
    logger.warn('[surfaces/slack] installation token missing — cannot reply', {
      teamId: args.teamId,
      channelId: args.channelId,
    })
    await degradeSlackConnectionByTeam({
      teamId: args.teamId,
      status: 'degraded',
      reason: 'installation_missing',
    })
    return { posted: false }
  }
  const body = await slackReplyPayload(withAgentAttribution(args.text, args.agentName))
  return await args.adapter.withBotToken(
    installation.botToken,
    async () => {
      try {
        if (args.editTs) {
          const result = await args.adapter.webClient.chat.update({
            channel: args.channelId,
            ts: args.editTs,
            ...body,
          } as Parameters<typeof args.adapter.webClient.chat.update>[0])
          return { ts: result.ts ?? args.editTs, posted: true }
        }
        const result = await args.adapter.webClient.chat.postMessage({
          channel: args.channelId,
          ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
          ...body,
          username: args.agentName,
          unfurl_links: false,
          unfurl_media: false,
        } as Parameters<typeof args.adapter.webClient.chat.postMessage>[0])
        return { ts: result.ts ?? undefined, posted: Boolean(result.ok) }
      } catch (error) {
        if (isSlackTokenRevokedError(error)) {
          await degradeSlackConnectionByTeam({
            teamId: args.teamId,
            status: 'degraded',
            reason: 'token_revoked',
          })
        }
        logger.warn('[surfaces/slack] reply post failed', {
          teamId: args.teamId,
          channelId: args.channelId,
          error: summarizeErrorForLog(error),
        })
        return { posted: false }
      }
    },
    { installationId: args.teamId },
  )
}
