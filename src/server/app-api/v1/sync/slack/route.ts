import 'server-only'

import type { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { withSlackBot } from '@/server/sync/slack/client'
import { canManageSync, handleSyncAction, syncErrorResponse, syncJson } from '../shared'

type SlackChannel = {
  id?: string
  name?: string
  is_private?: boolean
  is_ext_shared?: boolean
  is_shared?: boolean
  is_member?: boolean
  is_archived?: boolean
}

/**
 * GET /api/v1/sync/slack?action=channels — the Slack channels the workspace's
 * install can see, for the Link channel picker. Private channels appear only
 * once Overlay has been invited to them, which is also what live sync needs.
 */
export async function GET(request: NextRequest, context: AppApiRouteContext) {
  if (request.nextUrl.searchParams.get('action') !== 'channels') return syncJson({ error: 'Unknown action', code: 'invalid_request' }, 400)
  if (!canManageSync(context)) return syncErrorResponse(new Error('SYNC_MANAGE_DENIED'), 'slack')
  try {
    const connection = await convex.query<{ externalOrgId: string; status: string } | null>('sync/links:getConnection', {
      serverSecret: getInternalApiSecret(), workspaceId: context.workspace.workspace.id, provider: 'slack',
    }, { throwOnError: true })
    if (!connection || connection.status !== 'connected') return syncErrorResponse(new Error('SYNC_NOT_CONNECTED'), 'slack')
    const channels: SlackChannel[] = []
    await withSlackBot(connection.externalOrgId, async client => {
      let cursor: string | undefined
      for (let page = 0; page < 10; page += 1) {
        const result = await client.conversations.list({ types: 'public_channel,private_channel', exclude_archived: true, limit: 200, ...(cursor ? { cursor } : {}) })
        channels.push(...((result.channels ?? []) as SlackChannel[]))
        cursor = result.response_metadata?.next_cursor || undefined
        if (!cursor) break
      }
    })
    return syncJson({
      channels: channels
        .filter(channel => channel.id && channel.name && !channel.is_archived)
        .map(channel => ({
          id: channel.id!,
          name: channel.name!,
          kind: channel.is_ext_shared || channel.is_shared ? 'shared' : channel.is_private ? 'private' : 'public',
          isMember: channel.is_member === true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  } catch (error) {
    return syncErrorResponse(error, 'slack')
  }
}

/** POST /api/v1/sync/slack — link, unlink, auto-link and disconnect; disconnectAccount and dmSync for the member's own account. */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  return await handleSyncAction(request, context, 'slack')
}
