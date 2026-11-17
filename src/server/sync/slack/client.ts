import 'server-only'

import type { SlackAdapter } from '@chat-adapter/slack'
import { getSlackAdapter } from '@/server/surfaces/chat'
import { degradeSlackConnectionByTeam, isSlackTokenRevokedError } from '@/server/surfaces/slack-lifecycle'

export type SlackWebClient = SlackAdapter['webClient']

export class SlackSyncUnavailableError extends Error {}

/**
 * Runs Web API calls under a Slack workspace's bot token. Sync shares the
 * Overlay Slack app and its Chat SDK installation store with agent surfaces,
 * so the token resolves the same way agent replies do.
 */
export async function withSlackBot<T>(teamId: string, run: (client: SlackWebClient) => Promise<T>): Promise<T> {
  const adapter = await getSlackAdapter()
  const installation = await adapter.getInstallation(teamId)
  if (!installation?.botToken) {
    await degradeSlackConnectionByTeam({ teamId, status: 'degraded', reason: 'installation_missing' })
    throw new SlackSyncUnavailableError('The Slack installation token is missing')
  }
  try {
    return await adapter.withBotToken(installation.botToken, async () => await run(adapter.webClient), { installationId: teamId })
  } catch (error) {
    if (isSlackTokenRevokedError(error)) {
      await degradeSlackConnectionByTeam({ teamId, status: 'degraded', reason: 'token_revoked' })
      throw new SlackSyncUnavailableError('The Slack installation was revoked')
    }
    throw error
  }
}
