import 'server-only'

import type { SurfaceConnection } from '@overlay/workspace-contracts'
import { getSlackAdapter } from './chat'
import { degradeSlackConnectionByTeam, isSlackTokenRevokedError } from './slack-lifecycle'
import { SurfaceServiceError, type SurfaceChannelOption } from './SurfaceService'

/**
 * Lists the channels a connected Slack workspace exposes for binding. Runs
 * under the installation's bot token — the token resolves from the Chat SDK
 * state adapter keyed on the connection's externalTeamId. `isMember` reports
 * whether the bot has already joined the channel; unjoined channels stay
 * bindable but can't be answered until the bot is invited.
 */
export async function listSlackChannels(
  connection: SurfaceConnection,
): Promise<SurfaceChannelOption[]> {
  const adapter = await getSlackAdapter()
  const installation = await adapter.getInstallation(connection.externalTeamId)
  if (!installation?.botToken) {
    // The state adapter has no install — mark the connection so the editor
    // shows the reconnect state instead of a healthy-looking one.
    await degradeSlackConnectionByTeam({
      teamId: connection.externalTeamId,
      status: 'degraded',
      reason: 'installation_missing',
    })
    throw new SurfaceServiceError(
      'unavailable',
      'The Slack installation token is missing — reconnect the workspace',
    )
  }
  try {
    return await adapter.withBotToken(
      installation.botToken,
      async () => {
        const result = await adapter.webClient.conversations.list({
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: 200,
        })
        return (result.channels ?? [])
          .filter((channel) => channel.id && channel.name)
          .map((channel) => ({
            id: channel.id!,
            name: channel.name!,
            isMember: channel.is_member === true,
          }))
      },
      { installationId: connection.externalTeamId },
    )
  } catch (error) {
    if (isSlackTokenRevokedError(error)) {
      await degradeSlackConnectionByTeam({
        teamId: connection.externalTeamId,
        status: 'degraded',
        reason: 'token_revoked',
      })
      throw new SurfaceServiceError(
        'unavailable',
        'The Slack installation was revoked — reconnect the workspace',
      )
    }
    throw error
  }
}
