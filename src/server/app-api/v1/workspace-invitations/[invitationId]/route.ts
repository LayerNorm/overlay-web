import { NextResponse } from 'next/server'
import type { BffRouteContext } from '@/app/api/v1/_utils/bff'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlayCapabilities } from '@/server/capabilities'
import { ConvexWorkspaceRepository } from '@/server/workspaces/ConvexWorkspaceRepository'
import { WorkspaceInvitationPreviewService } from '@/server/workspaces/WorkspaceInvitationPreviewService'
import { workspaceErrorResponse } from '../../workspaces/route'

export async function GET(_request: Request, context: BffRouteContext) {
  try {
    const { invitationId } = await context.params
    if (typeof invitationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationId)) {
      return NextResponse.json({ error: 'Invitation not found', code: 'not_found' }, { status: 404 })
    }
    const server = getOverlayServerContext()
    const preview = await new WorkspaceInvitationPreviewService({
      workspaces: new ConvexWorkspaceRepository(),
      billing: server.appData.repositories.billing,
      billingEnabled: async () => (await getOverlayCapabilities()).billing,
    }).get(invitationId)
    return NextResponse.json(preview)
  } catch (error) {
    return workspaceErrorResponse(error, 'Could not load this invitation')
  }
}
