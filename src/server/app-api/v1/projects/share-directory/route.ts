import { NextRequest, NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { handleRouteError } from '@/server/app-api/route-errors'
import { readValidatedQuery } from '@/server/app-api/validated-input'
import { ProjectShareDirectoryQuery } from '@/shared/schemas/projects'
import { ProjectSharingService, ProjectServiceError } from '@/server/projects'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const query = readValidatedQuery(request, context, ProjectShareDirectoryQuery)
    if (!query.ok) return query.response
    const server = getOverlayServerContext()
    return NextResponse.json(await new ProjectSharingService({
      audit: server.auditService,
      authorization: server.authorizationService,
      authorizationRepositories: server.appData.repositories.authorization,
      projects: server.appData.repositories.projects,
      users: server.appData.repositories.users,
    }).listDirectory(context.auth.userId))
  } catch (error) {
    return projectSharingError(error, 'GET', 'Failed to list project sharing directory')
  }
}

function projectSharingError(error: unknown, operation: string, clientMessage: string) {
  if (error instanceof ProjectServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  return handleRouteError(error, {
    route: 'projects/share-directory',
    operation,
    clientMessage,
  })
}
