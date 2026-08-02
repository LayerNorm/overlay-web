import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

const MODES = new Set(['activity', 'banner', 'off'])
const KEYS = ['dmMessages', 'mentions', 'threadReplies', 'reactions', 'channelMessages'] as const

export async function GET(_request: Request, context: AppApiRouteContext) {
  const preferences = await getOverlayServerContext().appData.repositories.conversationCollaboration.getNotificationPreferences({
    actorUserId: context.auth.userId,
    workspaceId: context.workspace.workspace.id,
  })
  return NextResponse.json({ preferences })
}

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  const preferences: Record<string, 'activity' | 'banner' | 'off'> = {}
  for (const key of KEYS) {
    const value = context.parsedJson[key]
    if (value !== undefined) {
      if (typeof value !== 'string' || !MODES.has(value)) {
        return NextResponse.json({ error: `${key} must be activity, banner, or off` }, { status: 400 })
      }
      preferences[key] = value as 'activity' | 'banner' | 'off'
    }
  }
  const updated = await getOverlayServerContext().appData.repositories.conversationCollaboration.updateNotificationPreferences({
    actorUserId: context.auth.userId,
    workspaceId: context.workspace.workspace.id,
    preferences,
  })
  return NextResponse.json({ preferences: updated })
}
