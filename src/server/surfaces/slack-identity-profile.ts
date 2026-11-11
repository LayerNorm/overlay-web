import 'server-only'
import type { SlackAdapter } from '@chat-adapter/slack'

export async function slackIdentityDisplayName(
  identity: { externalTeamId: string; externalUserId: string; displayName?: string },
  getAdapter: () => Promise<SlackAdapter> = async () => (await import('./chat')).getSlackAdapter(),
): Promise<string | undefined> {
  const name = (value: unknown) => typeof value === 'string' ? value.trim().replace(/^@+/, '').slice(0, 256) || undefined : undefined
  try {
    const adapter = await getAdapter()
    const installation = await adapter.getInstallation(identity.externalTeamId)
    if (installation?.botToken) {
      const result = await adapter.withBotToken(installation.botToken,
        async () => await adapter.webClient.users.info({ user: identity.externalUserId }),
        { installationId: identity.externalTeamId })
      if (result.ok && result.user?.id === identity.externalUserId
        && (!result.user.team_id || result.user.team_id === identity.externalTeamId)) {
        return name(result.user.name) ?? name(result.user.profile?.display_name)
          ?? name(result.user.profile?.real_name) ?? name(identity.displayName)
      }
    }
  } catch (_error) { return name(identity.displayName) }
  return name(identity.displayName)
}
