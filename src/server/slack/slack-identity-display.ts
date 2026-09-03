import 'server-only'

import type {
  WorkspaceIdentityMapping,
  WorkspacePlatformIdentity,
} from '@overlay/workspace-contracts'
import { loadSlackApi } from './slack-adapter-modules'

export type SlackProfile = {
  displayName?: string
  avatarUrl?: string
}

export type IdentityDisplayDeps = {
  resolvePrincipalName: (principalId: string) => Promise<string | null>
  fetchSlackProfiles: (externalIds: string[]) => Promise<Map<string, SlackProfile>>
}

/**
 * Builds the settings-facing identity list. Principal names resolve from the
 * workspace; Slack display names resolve live through `users.info` on an
 * install token. Every lookup is best-effort: enrichment never fails the
 * list, and the directory/externalId pair stays the source of truth.
 */
export async function buildPlatformIdentities(
  mappings: WorkspaceIdentityMapping[],
  deps: IdentityDisplayDeps,
): Promise<WorkspacePlatformIdentity[]> {
  const slackIds = mappings
    .filter((mapping) => mapping.directory === 'slack' && mapping.status === 'active')
    .map((mapping) => mapping.externalId)
  const [names, profiles] = await Promise.all([
    resolveNames(mappings, deps.resolvePrincipalName),
    slackIds.length > 0
      ? deps.fetchSlackProfiles(slackIds).catch((_profilesError) => new Map<string, SlackProfile>())
      : Promise.resolve(new Map<string, SlackProfile>()),
  ])
  return mappings.map((mapping) => {
    const profile = mapping.directory === 'slack' ? profiles.get(mapping.externalId) : undefined
    return {
      directory: mapping.directory,
      externalId: mapping.externalId,
      principalId: mapping.principalId,
      ...(names.get(mapping.principalId) ? { principalDisplayName: names.get(mapping.principalId) } : {}),
      status: mapping.status,
      ...(profile?.displayName ? { platformDisplayName: profile.displayName } : {}),
      ...(profile?.avatarUrl ? { platformAvatarUrl: profile.avatarUrl } : {}),
    }
  })
}

async function resolveNames(
  mappings: WorkspaceIdentityMapping[],
  resolvePrincipalName: (principalId: string) => Promise<string | null>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  await Promise.all([...new Set(mappings.map((mapping) => mapping.principalId))].map(async (principalId) => {
    const name = await resolvePrincipalName(principalId).catch((_nameError) => null)
    if (name) names.set(principalId, name)
  }))
  return names
}

/** Live `users.info` lookup for Slack display names (injectable fetch for tests). */
export function createSlackProfileFetcher(args: {
  botToken: string
  fetchImpl?: typeof fetch
}): (externalIds: string[]) => Promise<Map<string, SlackProfile>> {
  return async (externalIds: string[]) => {
    const { callSlackApi } = await loadSlackApi()
    const profiles = new Map<string, SlackProfile>()
    await Promise.all(externalIds.map(async (externalId) => {
      try {
        const response = await callSlackApi<{
          ok: boolean
          user?: {
            name?: string
            real_name?: string
            profile?: { display_name?: string; real_name?: string; image_48?: string }
          }
        }>('users.info', { user: externalId }, {
          token: args.botToken,
          fetch: args.fetchImpl,
        })
        const user = response.ok ? response.user : undefined
        const displayName = user?.profile?.display_name?.trim()
          || user?.profile?.real_name?.trim()
          || user?.real_name?.trim()
          || user?.name?.trim()
          || undefined
        profiles.set(externalId, {
          ...(displayName ? { displayName } : {}),
          ...(user?.profile?.image_48 ? { avatarUrl: user.profile.image_48 } : {}),
        })
      } catch (_fetchError) {
        void _fetchError
        profiles.set(externalId, {})
      }
    }))
    return profiles
  }
}
