import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { SyncLinkRef, SyncMemberCredential, SyncOutboundAdapter } from '@/server/sync/adapters'
import { openSyncToken, sealSyncToken } from '@/server/sync/token-seal'
import { parseTeamsMessageKey, teamsMessageKey } from '@/shared/sync/teams'
import { markdownToTeamsHtml } from './convert'
import { GraphError, graphRequest, microsoftSyncCredentials, microsoftTokenRequest } from './graph'
import { teamsChannelPath } from './messages'
import { TEAMS_MEMBER_SCOPES } from './oauth'

const REFRESH_MARGIN_MS = 5 * 60 * 1000
const options = { throwOnError: true } as const

type StoredCredential = {
  externalOrgId: string
  externalUserId: string
  sealedToken: string
  sealedRefreshToken: string | null
  tokenExpiresAt: number | null
}

/**
 * A member's Teams credential for the outbound worker, refreshed when it is
 * within five minutes of expiring. Microsoft rotates refresh tokens, so both
 * are stored again. A rejected refresh token revokes the account, and null
 * tells the worker the member must connect Teams again.
 */
export async function resolveTeamsMemberCredential(args: { workspaceId: string; userId: string }): Promise<SyncMemberCredential | null> {
  const serverSecret = getInternalApiSecret()
  const stored = await convex.query<StoredCredential | null>('sync/teamsAccounts:getCredential', { serverSecret, ...args }, options)
  if (!stored) return null
  if (!stored.tokenExpiresAt || stored.tokenExpiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return { externalUserId: stored.externalUserId, accessToken: openSyncToken(stored.sealedToken) }
  }
  if (!stored.sealedRefreshToken) {
    await convex.mutation('sync/teamsAccounts:revoke', { serverSecret, ...args }, options)
    return null
  }
  const { clientId, clientSecret } = microsoftSyncCredentials()
  let body: Record<string, unknown>
  try {
    body = await microsoftTokenRequest(stored.externalOrgId, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: openSyncToken(stored.sealedRefreshToken),
      scope: TEAMS_MEMBER_SCOPES.filter(scope => scope !== 'openid' && scope !== 'profile').join(' '),
    })
  } catch (error) {
    if (!(error instanceof GraphError) || error.code !== 'invalid_grant') throw error
    await convex.mutation('sync/teamsAccounts:revoke', { serverSecret, ...args }, options)
    return null
  }
  if (typeof body.access_token !== 'string') throw new Error('Microsoft returned no access token')
  await convex.mutation('sync/teamsAccounts:storeTokens', {
    serverSecret,
    ...args,
    sealedToken: sealSyncToken(body.access_token),
    ...(typeof body.refresh_token === 'string' ? { sealedRefreshToken: sealSyncToken(body.refresh_token) } : {}),
    tokenExpiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
  }, options)
  return { externalUserId: stored.externalUserId, accessToken: body.access_token }
}

function messagePath(link: SyncLinkRef, externalMessageId: string): string {
  const { messageId, rootId } = parseTeamsMessageKey(externalMessageId)
  return teamsChannelPath(link) + (rootId
    ? '/messages/' + encodeURIComponent(rootId) + '/replies/' + encodeURIComponent(messageId)
    : '/messages/' + encodeURIComponent(messageId))
}

/**
 * Posts in Teams as the member, with their delegated ChannelMessage.Send
 * grant, so the message shows under their name in every channel type. Reply
 * ids come back as root/reply keys, matching what inbound sync records, so the
 * echo is dropped by id. Editing and deleting need ChannelMessage.ReadWrite,
 * which members grant only once outward edits ship (plan Phase 6).
 */
export const teamsOutboundAdapter: SyncOutboundAdapter = {
  provider: 'teams',
  async post(link, credential, message) {
    const rootId = message.externalThreadId ? parseTeamsMessageKey(message.externalThreadId).rootId ?? message.externalThreadId : undefined
    const path = teamsChannelPath(link) + '/messages' + (rootId ? '/' + encodeURIComponent(rootId) + '/replies' : '')
    const created = await graphRequest<{ id: string }>(credential.accessToken, path, {
      method: 'POST',
      body: { body: { contentType: 'html', content: markdownToTeamsHtml(message.content) } },
    })
    return { externalMessageId: teamsMessageKey(created.id, rootId) }
  },
  async edit(link, credential, externalMessageId, message) {
    await graphRequest(credential.accessToken, messagePath(link, externalMessageId), {
      method: 'PATCH',
      body: { body: { contentType: 'html', content: markdownToTeamsHtml(message.content) } },
    })
  },
  async remove(link, credential, externalMessageId) {
    await graphRequest(credential.accessToken, messagePath(link, externalMessageId) + '/softDelete', { method: 'POST', body: {} })
  },
  async react(link, credential, externalMessageId, emoji, enabled) {
    await graphRequest(credential.accessToken, messagePath(link, externalMessageId) + (enabled ? '/setReaction' : '/unsetReaction'), {
      method: 'POST',
      body: { reactionType: emoji },
    })
  },
}
