import 'server-only'

import type { SurfaceConnection } from '@overlay/workspace-contracts'
import { getSlackAdapter } from './chat'
import { SurfaceServiceError, type SurfaceChannelOption } from './SurfaceService'

/**
 * Lists the channels a connected Slack workspace exposes for binding. Runs
 * under the installation's bot token — the token resolves from the Chat SDK
 * state adapter keyed on the connection's externalTeamId.
 */
export async function listSlackChannels(
  connection: SurfaceConnection,
): Promise<SurfaceChannelOption[]> {
  const adapter = getSlackAdapter()
  const installation = await adapter.getInstallation(connection.externalTeamId)
  if (!installation?.botToken) {
    throw new SurfaceServiceError(
      'unavailable',
      'The Slack installation token is missing — reconnect the workspace',
    )
  }
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
        .map((channel) => ({ id: channel.id!, name: channel.name! }))
    },
    { installationId: connection.externalTeamId },
  )
}
