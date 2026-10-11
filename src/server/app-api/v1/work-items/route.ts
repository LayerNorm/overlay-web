import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { scopeForbiddenResponse } from '@/server/app-api/scope-errors'
import { parseResourceView } from '@/shared/workspaces/resource-scope'
import { repositoryProxy } from '@/server/app-data/errors'
import {
  WorkItemRevisionConflictError,
  WorkItemService,
  WorkItemServiceError,
  type WorkItemRepository,
  type WorkItemScopeActionResult,
  type WorkItemStatus,
} from '@/server/work'
import { WORK_ITEM_STATUSES } from '@/shared/work/work-items'
import { CreateWorkItemRequest, UpdateWorkItemRequest } from '@/shared/schemas/work-items'
import type { ZodType } from 'zod'

const workItemService = new WorkItemService(
  repositoryProxy<WorkItemRepository>(
    () => getOverlayServerContext().appData.repositories.workItems,
  ),
)

function readBooleanParam(value: string | null): boolean | undefined {
  if (value == null) return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}

/** A 400 naming the first field that failed, so a bad value is rejected instead of silently dropped. */
function parseBody<T>(schema: ZodType<T>, body: unknown): { ok: true; data: T } | { ok: false; response: NextResponse } {
  const parsed = schema.safeParse(body)
  if (parsed.success) return { ok: true, data: parsed.data }
  const issue = parsed.error.issues[0]
  const field = issue?.path.join('.') || undefined
  return {
    ok: false,
    response: NextResponse.json({ error: issue?.message ?? 'Invalid request', ...(field ? { field } : {}) }, { status: 400 }),
  }
}

async function readJsonBody<T>(request: NextRequest, fallback: T): Promise<T> {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return fallback
  try {
    return (await request.json()) as T
  } catch (_error) {
    return fallback
  }
}

function scopeActionResponse(result: WorkItemScopeActionResult): NextResponse {
  if (result.ok) return NextResponse.json({ success: true })
  const status = result.reason === 'not_found' ? 404 : result.reason === 'subtask_follows_parent' ? 400 : 403
  return NextResponse.json({ error: result.reason }, { status })
}

function toErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof WorkItemRevisionConflictError) {
    return NextResponse.json({
      success: false,
      error: error.message,
      conflict: {
        localRevision: error.expectedUpdatedAt === undefined ? undefined : String(error.expectedUpdatedAt),
        remoteRevision: String(error.currentUpdatedAt),
        message: error.message,
      },
    }, { status: 409 })
  }
  if (error instanceof WorkItemServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  logger.error(`[Work API] ${fallbackMessage}:`, error)
  return NextResponse.json({ error: fallbackMessage }, { status: 500 })
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const params = request.nextUrl.searchParams
    const workspaceId = context.workspace.workspace.id

    const itemId = params.get('itemId')
    if (itemId) {
      const detail = await workItemService.getWorkItem({ itemId, userId: auth.userId, workspaceId })
      if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(detail)
    }

    const text = params.get('q') ?? params.get('search')
    if (text) {
      const results = await workItemService.searchWorkItems({ userId: auth.userId, workspaceId, text })
      return NextResponse.json(results)
    }

    const statusParam = params.get('status')
    if (statusParam && !(WORK_ITEM_STATUSES as readonly string[]).includes(statusParam)) {
      return NextResponse.json({ error: 'Invalid status', field: 'status' }, { status: 400 })
    }
    const items = await workItemService.listWorkItems({
      userId: auth.userId,
      workspaceId,
      view: parseResourceView(params.get('view')),
      status: (statusParam || undefined) as WorkItemStatus | undefined,
      assigneeUserId: params.get('assigneeUserId') ?? undefined,
      parentItemId: params.get('parentItemId') ?? undefined,
      includeDeleted: readBooleanParam(params.get('includeDeleted')),
    })
    return NextResponse.json(items)
  } catch (error) {
    return toErrorResponse(error, 'Failed to fetch work items')
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const parsed = parseBody(CreateWorkItemRequest, await readJsonBody<unknown>(request, {}))
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const { auth } = context
    const result = await workItemService.createWorkItem({
      title: body.title,
      description: body.description,
      status: body.status,
      priority: body.priority,
      assigneeUserId: body.assigneeUserId,
      startDate: body.startDate,
      dueDate: body.dueDate,
      labels: body.labels,
      parentItemId: body.parentItemId,
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
      scope: body.scope,
    })
    return NextResponse.json(result)
  } catch (error) {
    return scopeForbiddenResponse(error) ?? toErrorResponse(error, 'Failed to create work item')
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const parsed = parseBody(UpdateWorkItemRequest, await readJsonBody<unknown>(request, {}))
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const { auth } = context
    const workspaceId = context.workspace.workspace.id

    if (body.action === 'archive') {
      return scopeActionResponse(await workItemService.archiveWorkItem({ itemId: body.itemId, userId: auth.userId, workspaceId }))
    }
    if (body.action === 'restore') {
      return scopeActionResponse(await workItemService.restoreWorkItem({ itemId: body.itemId, userId: auth.userId, workspaceId }))
    }
    if (body.action === 'move') {
      if (!body.scope) return NextResponse.json({ error: 'scope is required for move', field: 'scope' }, { status: 400 })
      return scopeActionResponse(await workItemService.setWorkItemScope({ itemId: body.itemId, userId: auth.userId, workspaceId, to: body.scope }))
    }

    const result = await workItemService.updateWorkItem({
      itemId: body.itemId,
      userId: auth.userId,
      workspaceId,
      title: body.title,
      description: body.description,
      status: body.status,
      priority: body.priority,
      assigneeUserId: body.assigneeUserId,
      clearAssignee: body.clearAssignee,
      startDate: body.startDate,
      dueDate: body.dueDate,
      clearDates: body.clearDates,
      clearStartDate: body.clearStartDate,
      clearDueDate: body.clearDueDate,
      labels: body.labels,
      parentItemId: body.parentItemId,
      clearParent: body.clearParent,
      orderKey: body.orderKey,
      expectedUpdatedAt: body.expectedUpdatedAt,
    })
    return NextResponse.json(result)
  } catch (error) {
    return scopeForbiddenResponse(error) ?? toErrorResponse(error, 'Failed to update work item')
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const result = await workItemService.deleteWorkItem({
      itemId: request.nextUrl.searchParams.get('itemId') ?? '',
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json(result)
  } catch (error) {
    return scopeForbiddenResponse(error) ?? toErrorResponse(error, 'Failed to delete work item')
  }
}
