import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedResourceUserId, getGrantedResources, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationErrorResponse, automationService } from '@/server/automations/http'
import { getOverlayServerContext } from '@/server/bootstrap'

async function readJsonBody(request: NextRequest, context: AppApiRouteContext) {
  if (Object.keys(context.parsedJson).length > 0) return context.parsedJson
  return await request.json()
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const automationId = request.nextUrl.searchParams.get('automationId')
    const projectId = request.nextUrl.searchParams.get('projectId') || undefined
    const includeDeleted = request.nextUrl.searchParams.get('includeDeleted') === 'true'
    const includeRuns =
      request.nextUrl.searchParams.get('runs') === 'true' ||
      request.nextUrl.searchParams.get('includeRuns') === 'true'
    const result = await automationService.getAutomations({
      userId: getAuthorizedResourceUserId(context),
      automationId,
      projectId,
      includeDeleted,
      includeRuns,
    })
    if (!Array.isArray(result) || automationId) return NextResponse.json(result)
    const granted = await Promise.all(getGrantedResources(context).map(({ ownerUserId, resourceId }) => (
      automationService.getAutomations({ automationId: resourceId, userId: ownerUserId })
    )))
    return NextResponse.json([...result, ...granted])
  } catch (error) {
    if (error instanceof Error && error.name === 'AutomationServiceError') {
      return automationErrorResponse(error, 'Failed to fetch automations')
    }
    logger.error('[automations GET]', error)
    return NextResponse.json({ error: 'Failed to fetch automations' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await readJsonBody(request, context)
    const { auth } = context
    const result = await automationService.createAutomation({
      userId: auth.userId,
      body,
    })
    if (typeof result.id === 'string') {
      await getOverlayServerContext().workspaceService.bindResource({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        resourceType: 'automation',
        resourceId: result.id,
      })
    }
    return NextResponse.json(result)
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AutomationServiceError')) {
      logger.error('[automations POST]', error)
    }
    return automationErrorResponse(error, 'Failed to create automation')
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await readJsonBody(request, context)
    const { auth } = context
    const result = await automationService.updateAutomation({
      userId: getAuthorizedResourceUserId(context),
      body,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AutomationServiceError')) {
      logger.error('[automations PATCH]', error)
    }
    return automationErrorResponse(error, 'Failed to update automation')
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    let body: { accessToken?: string; userId?: string; automationId?: string } = {}
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      body = await readJsonBody(request, context).catch((_error) => ({}))
    }
    const { auth } = context
    const result = await automationService.deleteAutomation({
      automationId: body.automationId || request.nextUrl.searchParams.get('automationId'),
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json(result)
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AutomationServiceError')) {
      logger.error('[automations DELETE]', error)
    }
    return automationErrorResponse(error, 'Failed to delete automation')
  }
}
