import { NextResponse } from 'next/server'
import type { WorkspacePlatformInstallationSummary } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'

/** Manager-visible install inventory. Tokens are never included. */
export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const installs = await getOverlayServerContext().workspaceGovernanceService.listPlatformInstallations({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    const response: { installations: WorkspacePlatformInstallationSummary[] } = {
      installations: installs.map((install) => ({
        directory: install.directory,
        externalTeamId: install.externalTeamId,
        ...(install.teamName ? { teamName: install.teamName } : {}),
        installedByPrincipalId: install.installedByPrincipalId,
        createdAt: install.createdAt,
        updatedAt: install.updatedAt,
      })),
    }
    return NextResponse.json(response)
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to load platform installations')
  }
}
