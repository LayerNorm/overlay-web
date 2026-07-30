import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  parseWorkspaceSearchKinds,
  WORKSPACE_SEARCH_DEFAULT_LIMIT,
} from '@/shared/search/workspace-search'

/**
 * Workspace-wide search. Results are permission-filtered server-side; the query
 * string never widens what the actor may see.
 */
export async function GET(_request: Request, context: AppApiRouteContext) {
  const serverContext = getOverlayServerContext()
  await serverContext.workspaceGovernanceService.assertWithinLimits({
    action: 'search.query',
    scope: {
      workspaceId: context.workspace.workspace.id,
      principalId: context.workspace.principal.id,
      guest: context.workspace.membership.role === 'guest',
    },
  })
  const response = await serverContext.workspaceSearchService.search({
    actorUserId: context.auth.userId,
    workspaceId: context.workspace.workspace.id,
    query: typeof context.parsedQuery.q === 'string' ? context.parsedQuery.q : '',
    kinds: parseWorkspaceSearchKinds(context.parsedQuery.kinds),
    limitPerKind: limit(context.parsedQuery.limit),
  })
  return NextResponse.json(response)
}

function limit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return WORKSPACE_SEARCH_DEFAULT_LIMIT
  return Math.min(parsed, 25)
}
