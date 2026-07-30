import 'server-only'

import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'

/**
 * Public links are General access, not a collaborator grant, so they answer to
 * workspace policy. Every route that can turn a resource into a public link
 * calls this before writing, in both persistence providers.
 */
export async function assertPublicLinkPolicy(context: AppApiRouteContext): Promise<void> {
  await getOverlayServerContext().workspaceService.assertPublicLinksAllowed({
    actorUserId: context.auth.userId,
    workspaceId: context.workspace?.workspace.id,
  })
}

/** Returns a response only when the failure was the public-link policy. */
export function publicLinkPolicyResponse(error: unknown): NextResponse | null {
  if (!(error instanceof WorkspaceServiceError) || error.code !== 'forbidden') return null
  return NextResponse.json(
    { error: error.message, code: 'workspace_public_links_disabled' },
    { status: 403 },
  )
}
