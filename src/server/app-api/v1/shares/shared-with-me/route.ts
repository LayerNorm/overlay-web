import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { parseWorkspaceSearchKinds } from '@/shared/search/workspace-search'

/**
 * Everything in this workspace the actor reaches through a grant rather than
 * ownership. Guests see only what was explicitly shared with them, which is
 * exactly what this returns.
 */
export async function GET(_request: Request, context: AppApiRouteContext) {
  const results = await getOverlayServerContext().workspaceSearchService.listSharedWithMe({
    actorUserId: context.auth.userId,
    workspaceId: context.workspace.workspace.id,
    kinds: parseWorkspaceSearchKinds(context.parsedQuery.kinds),
  })
  return NextResponse.json({ results })
}
