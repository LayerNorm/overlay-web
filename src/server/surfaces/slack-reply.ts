import 'server-only'

import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import type { SlackAdapter } from '@chat-adapter/slack'
import { degradeSlackConnectionByTeam, isSlackTokenRevokedError } from './slack-lifecycle'

// Slack rejects messages over ~40k chars; keep well under with headroom for
// markdown expansion.
const SLACK_MESSAGE_CHAR_LIMIT = 38_000

export function truncateForSlack(text: string): string {
  if (text.length <= SLACK_MESSAGE_CHAR_LIMIT) return text
  return `${text.slice(0, SLACK_MESSAGE_CHAR_LIMIT - 20).trimEnd()}\n\n…`
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
  const text = truncateForSlack(args.text)
  return await args.adapter.withBotToken(
    installation.botToken,
    async () => {
      try {
        if (args.editTs) {
          const result = await args.adapter.webClient.chat.update({
            channel: args.channelId,
            ts: args.editTs,
            text,
          })
          return { ts: result.ts ?? args.editTs, posted: true }
        }
        const result = await args.adapter.webClient.chat.postMessage({
          channel: args.channelId,
          ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
          text,
          username: args.agentName,
          unfurl_links: false,
          unfurl_media: false,
        })
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
