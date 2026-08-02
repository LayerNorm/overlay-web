import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

export async function GET(request: Request, context: AppApiRouteContext) {
  const params = new URL(request.url).searchParams
  const query = params.get('q')?.trim() ?? ''
  if (!query) return NextResponse.json({ results: [] })
  const requestedLimit = Number(params.get('limit') ?? 25)
  const results = await getOverlayServerContext().appData.repositories
    .conversationCollaboration.searchWorkspaceChats({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      query,
      limit: Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 25,
    })
  return NextResponse.json({ results })
}
