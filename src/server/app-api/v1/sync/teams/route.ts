import 'server-only'

import { after, type NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { logger } from '@/server/observability/logger'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { graphAppToken, graphRequest, isAppMissing } from '@/server/sync/teams/graph'
import { createTeamsSubscription, deleteTeamsSubscription, type TeamsManagedLink } from '@/server/sync/teams/subscriptions'
import type { SyncChannelKind } from '@/shared/sync/types'
import { canManageSync, handleSyncAction, syncErrorResponse, syncJson } from '../shared'

const MAX_TEAMS = 500
const CONCURRENCY = 8
const options = { throwOnError: true } as const

type GraphPage<T> = { value?: T[]; '@odata.nextLink'?: string }
type TeamsChannel = { id?: string; displayName?: string; membershipType?: string }

const KINDS: Record<string, SyncChannelKind> = { standard: 'public', private: 'private', shared: 'shared' }

/**
 * GET /api/v1/sync/teams?action=channels — channels in teams where Overlay is
 * installed. Teams are listed with the admin-consented Team.ReadBasic.All
 * grant; each team's channels are then read under its ChannelSettings.Read.Group
 * resource-specific consent, which only exists where the Overlay Teams app is
 * installed, so teams without it answer 403 and are left out.
 */
export async function GET(request: NextRequest, context: AppApiRouteContext) {
  if (request.nextUrl.searchParams.get('action') !== 'channels') return syncJson({ error: 'Unknown action', code: 'invalid_request' }, 400)
  if (!canManageSync(context)) return syncErrorResponse(new Error('SYNC_MANAGE_DENIED'), 'teams')
  try {
    const connection = await convex.query<{ externalOrgId: string; status: string } | null>('sync/links:getConnection', {
      serverSecret: getInternalApiSecret(), workspaceId: context.workspace.workspace.id, provider: 'teams',
    }, options)
    if (!connection || connection.status !== 'connected') return syncErrorResponse(new Error('SYNC_NOT_CONNECTED'), 'teams')
    const token = await graphAppToken(connection.externalOrgId)
    const teams: Array<{ id: string; displayName?: string }> = []
    let next: string | undefined = '/teams?$select=id,displayName&$top=100'
    while (next && teams.length < MAX_TEAMS) {
      const page: GraphPage<{ id: string; displayName?: string }> = await graphRequest(token, next)
      teams.push(...(page.value ?? []))
      next = page['@odata.nextLink']
    }
    const channels: Array<{ id: string; name: string; kind: SyncChannelKind; groupId: string; groupName: string }> = []
    for (let index = 0; index < teams.length; index += CONCURRENCY) {
      await Promise.all(teams.slice(index, index + CONCURRENCY).map(async team => {
        try {
          const page = await graphRequest<GraphPage<TeamsChannel>>(token, '/teams/' + encodeURIComponent(team.id) + '/channels?$select=id,displayName,membershipType')
          for (const channel of page.value ?? []) {
            if (!channel.id || !channel.displayName) continue
            channels.push({ id: channel.id, name: channel.displayName, kind: KINDS[channel.membershipType ?? 'standard'] ?? 'public', groupId: team.id, groupName: team.displayName ?? team.id })
          }
        } catch (error) {
          if (!isAppMissing(error)) throw error
        }
      }))
    }
    return syncJson({
      channels: channels.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name)),
      ...(teams.length >= MAX_TEAMS ? { truncated: true } : {}),
    })
  } catch (error) {
    return syncErrorResponse(error, 'teams')
  }
}

/**
 * POST /api/v1/sync/teams — link, unlink, auto-link and disconnect through the
 * shared handler. Teams links need the team id (groupId). A new standard
 * channel link is subscribed to Graph notifications after the response; an
 * unlinked channel's subscription is deleted.
 */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  const body = await request.clone().json().catch((_error) => null) as { action?: string; groupId?: unknown; linkId?: unknown } | null
  if (body?.action === 'link' && (typeof body.groupId !== 'string' || !body.groupId.trim())) {
    return syncJson({ error: 'Teams channels need their team id (groupId).', code: 'invalid_request' }, 400)
  }
  const serverSecret = getInternalApiSecret()
  const unlinking = body?.action === 'unlink' && typeof body.linkId === 'string' && canManageSync(context)
    ? await convex.query<TeamsManagedLink & { workspaceId: string } | null>('sync/teamsLinks:getLink', { serverSecret, linkId: body.linkId }, options).catch((_error) => null)
    : null
  const response = await handleSyncAction(request, context, 'teams')
  if (!response.ok) return response
  if (body?.action === 'link') {
    const { linkId } = await response.clone().json() as { linkId: string }
    after(async () => {
      const link = await convex.query<TeamsManagedLink | null>('sync/teamsLinks:getLink', { serverSecret, linkId }, options)
      if (link?.externalChannelKind !== 'public') return
      await createTeamsSubscription(link).catch((error) => logger.warn('[sync/teams] subscription after link failed', { linkId, error: String(error) }))
    })
  }
  if (unlinking?.subscriptionId && unlinking.workspaceId === context.workspace.workspace.id) {
    const { externalOrgId, subscriptionId } = unlinking
    after(async () => { await deleteTeamsSubscription(externalOrgId, subscriptionId) })
  }
  return response
}
