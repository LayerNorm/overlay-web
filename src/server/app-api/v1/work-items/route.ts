import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { scopeForbiddenResponse } from '@/server/app-api/scope-errors'
import { parseResourceScope, parseResourceView } from '@/shared/workspaces/resource-scope'
import { repositoryProxy } from '@/server/app-data/errors'
import {
  WorkItemRevisionConflictError,
  WorkItemService,
  WorkItemServiceError,
  type WorkItemRepository,
  type WorkItemScopeActionResult,
  type WorkItemStatus,
} from '@/server/work'
import { WORK_ITEM_STATUSES, WORK_ITEM_PRIORITIES, type WorkItemPriority } from '@/shared/work/work-items'

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

function parseStatus(value: unknown): WorkItemStatus | undefined {
  return typeof value === 'string' && (WORK_ITEM_STATUSES as readonly string[]).includes(value)
    ? value as WorkItemStatus
    : undefined
}

function parsePriority(value: unknown): WorkItemPriority | undefined {
  return typeof value === 'string' && (WORK_ITEM_PRIORITIES as readonly string[]).includes(value)
    ? value as WorkItemPriority
    : undefined
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
  const status = result.reason === 'not_found' ? 404 : 403
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

interface UpdateWorkItemBody {
  itemId?: string
  title?: string
  description?: string
  status?: string
  priority?: string
  assigneeUserId?: string
  clearAssignee?: boolean
  startDate?: number
  dueDate?: number
  clearDates?: boolean
  labels?: string[]
  parentItemId?: string
  orderKey?: string
  expectedUpdatedAt?: number
  /** Scope actions: archive/restore, or move between Personal and Workspace. */
  action?: 'archive' | 'restore' | 'move'
  scope?: string
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

    const items = await workItemService.listWorkItems({
      userId: auth.userId,
      workspaceId,
      view: parseResourceView(params.get('view')),
      status: parseStatus(params.get('status')),
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
    const body = await readJsonBody<UpdateWorkItemBody>(request, {})
    const { auth } = context
    const result = await workItemService.createWorkItem({
      title: body.title ?? '',
      description: body.description,
      status: parseStatus(body.status),
      priority: parsePriority(body.priority),
      assigneeUserId: body.assigneeUserId,
      startDate: body.startDate,
      dueDate: body.dueDate,
      labels: body.labels,
      parentItemId: body.parentItemId,
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
      scope: parseResourceScope(body.scope),
    })
    return NextResponse.json(result)
  } catch (error) {
    return scopeForbiddenResponse(error) ?? toErrorResponse(error, 'Failed to create work item')
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await readJsonBody<UpdateWorkItemBody>(request, {})
    const { auth } = context
    const workspaceId = context.workspace.workspace.id
    if (!body.itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 })

    if (body.action === 'archive') {
      return scopeActionResponse(await workItemService.archiveWorkItem({ itemId: body.itemId, userId: auth.userId, workspaceId }))
    }
    if (body.action === 'restore') {
      return scopeActionResponse(await workItemService.restoreWorkItem({ itemId: body.itemId, userId: auth.userId, workspaceId }))
    }
    if (body.action === 'move') {
      const to = parseResourceScope(body.scope)
      if (!to) return NextResponse.json({ error: 'scope is required for move' }, { status: 400 })
      return scopeActionResponse(await workItemService.setWorkItemScope({ itemId: body.itemId, userId: auth.userId, workspaceId, to }))
    }

    const result = await workItemService.updateWorkItem({
      itemId: body.itemId,
      userId: auth.userId,
      workspaceId,
      title: body.title,
      description: body.description,
      status: parseStatus(body.status),
      priority: parsePriority(body.priority),
      assigneeUserId: body.assigneeUserId,
      clearAssignee: body.clearAssignee,
      startDate: body.startDate,
      dueDate: body.dueDate,
      clearDates: body.clearDates,
      labels: body.labels,
      parentItemId: body.parentItemId,
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
    return toErrorResponse(error, 'Failed to delete work item')
  }
}
