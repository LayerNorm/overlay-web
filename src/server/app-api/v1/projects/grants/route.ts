import { NextRequest, NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { handleRouteError } from '@/server/app-api/route-errors'
import { readValidatedJson, readValidatedQuery } from '@/server/app-api/validated-input'
import {
  CreateProjectGrantRequest,
  DeleteProjectGrantRequest,
  ProjectGrantListQuery,
} from '@/shared/schemas/projects'
import { ProjectSharingService, ProjectServiceError } from '@/server/projects'

function service() {
  const server = getOverlayServerContext()
  return new ProjectSharingService({
    audit: server.auditService,
    authorization: server.authorizationService,
    authorizationRepositories: server.appData.repositories.authorization,
    projects: server.appData.repositories.projects,
    users: server.appData.repositories.users,
  })
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const query = readValidatedQuery(request, context, ProjectGrantListQuery)
    if (!query.ok) return query.response
    return NextResponse.json({
      grants: await service().listShares({
        projectId: query.data.projectId,
        userId: context.auth.userId,
      }),
    })
  } catch (error) {
    return projectSharingError(error, 'GET', 'Failed to list project shares')
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await readValidatedJson(request, context, CreateProjectGrantRequest)
    if (!body.ok) return body.response
    const grant = await service().shareProject({
      ...body.data,
      userId: context.auth.userId,
    })
    return NextResponse.json({ grant }, { status: 201 })
  } catch (error) {
    return projectSharingError(error, 'POST', 'Failed to share project')
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await readValidatedJson(request, context, DeleteProjectGrantRequest)
    if (!body.ok) return body.response
    await service().revokeProjectShare({
      ...body.data,
      userId: context.auth.userId,
    })
    return NextResponse.json({ removed: true, grantId: body.data.grantId })
  } catch (error) {
    return projectSharingError(error, 'DELETE', 'Failed to revoke project share')
  }
}

function projectSharingError(error: unknown, operation: string, clientMessage: string) {
  if (error instanceof ProjectServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  return handleRouteError(error, {
    route: 'projects/grants',
    operation,
    clientMessage,
  })
}
