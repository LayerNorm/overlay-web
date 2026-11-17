import 'server-only'

import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import type { SyncChannelKind, SyncProvider } from '@/shared/sync/types'

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const options = { throwOnError: true } as const

/** Convex sync errors that are the caller's to fix, with the status and copy the settings page shows. */
const KNOWN_ERRORS: Record<string, [number, string]> = {
  SYNC_MANAGE_DENIED: [403, 'Only workspace owners and admins can change sync settings.'],
  SYNC_NOT_CONNECTED: [409, 'Connect the workspace first.'],
  SYNC_ALREADY_CONNECTED: [409, 'This workspace is already connected to a different organization.'],
  SYNC_ORG_CONNECTED_ELSEWHERE: [409, 'That organization is already connected to another Overlay workspace.'],
  SYNC_CHANNEL_ALREADY_LINKED: [409, 'That channel is already linked.'],
  SYNC_TARGET_INVALID: [400, 'Choose an Overlay channel you belong to.'],
  SYNC_TARGET_ALREADY_LINKED: [409, 'That Overlay channel already syncs with another channel.'],
  SYNC_TARGET_MUST_BE_PRIVATE: [400, 'Private and shared channels can only sync into private Overlay channels.'],
  WORKSPACE_ACCESS_DENIED: [403, 'You do not have access to this workspace.'],
}

export function syncJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export function syncErrorResponse(error: unknown, scope: string) {
  const message = error instanceof Error ? error.message : ''
  const code = Object.keys(KNOWN_ERRORS).find(key => message.includes(key))
  if (code) {
    const [status, text] = KNOWN_ERRORS[code]!
    return syncJson({ error: text, code }, status)
  }
  logger.error('[sync/' + scope + '] request failed', error)
  return syncJson({ error: 'Sync request failed', code: 'internal_error' }, 500)
}

export function canManageSync(context: AppApiRouteContext): boolean {
  const role = context.workspace.membership.role
  return role === 'owner' || role === 'admin'
}

type ActionBody =
  | { action: 'link'; channelId: string; groupId?: string; name: string; kind: SyncChannelKind; existingConversationId?: string }
  | { action: 'unlink'; linkId: string }
  | { action: 'autoLink'; enabled: boolean }
  | { action: 'disconnect' }

function parseAction(raw: unknown): ActionBody | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as Record<string, unknown>
  const text = (key: string) => typeof body[key] === 'string' && (body[key] as string).trim() ? (body[key] as string).trim() : undefined
  switch (body.action) {
    case 'link': {
      const channelId = text('channelId')
      const name = text('name')
      const kind = body.kind
      if (!channelId || !name || (kind !== 'public' && kind !== 'private' && kind !== 'shared')) return null
      return { action: 'link', channelId, name: name.slice(0, 120), kind, groupId: text('groupId'), existingConversationId: text('existingConversationId') }
    }
    case 'unlink': {
      const linkId = text('linkId')
      return linkId ? { action: 'unlink', linkId } : null
    }
    case 'autoLink':
      return typeof body.enabled === 'boolean' ? { action: 'autoLink', enabled: body.enabled } : null
    case 'disconnect':
      return { action: 'disconnect' }
    default:
      return null
  }
}

/** Shared POST handler for the settings page's link, unlink, auto-link and disconnect actions. */
export async function handleSyncAction(request: Request, context: AppApiRouteContext, provider: SyncProvider) {
  if (!canManageSync(context)) return syncErrorResponse(new Error('SYNC_MANAGE_DENIED'), provider)
  const body = parseAction(await request.json().catch((_error) => null))
  if (!body) return syncJson({ error: 'Invalid sync request', code: 'invalid_request' }, 400)
  const base = { serverSecret: getInternalApiSecret(), actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id }
  try {
    if (body.action === 'link') {
      const result = await convex.mutation('sync/links:linkChannel', {
        ...base, provider, externalChannelId: body.channelId, externalChannelName: body.name, externalChannelKind: body.kind,
        ...(body.groupId ? { externalGroupId: body.groupId } : {}),
        ...(body.existingConversationId ? { existingConversationId: body.existingConversationId } : {}),
      }, options)
      return syncJson(result)
    }
    if (body.action === 'unlink') {
      await convex.mutation('sync/links:unlinkChannel', { ...base, linkId: body.linkId }, options)
    } else if (body.action === 'autoLink') {
      await convex.mutation('sync/links:setAutoLink', { ...base, provider, enabled: body.enabled }, options)
    } else {
      await convex.mutation('sync/links:disconnect', { ...base, provider }, options)
    }
    return syncJson({ ok: true })
  } catch (error) {
    return syncErrorResponse(error, provider)
  }
}
