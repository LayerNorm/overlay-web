import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { MemoryServiceError, type MemoryActor, type MemorySource, type MemoryType } from '@/server/memory'
import { memoriesToClientListRows } from '@/shared/knowledge/memory-display-segments'

function readBooleanParam(value: string | null): boolean | undefined {
  if (value == null) return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const server = getOverlayServerContext()
    const service = server.memoryService
    const memoryId = request.nextUrl.searchParams.get('memoryId')
    const raw = readBooleanParam(request.nextUrl.searchParams.get('raw')) === true
    const includeDeleted = readBooleanParam(request.nextUrl.searchParams.get('includeDeleted'))
    if (memoryId) {
      const memory = await service.get({
        includeDeleted: raw,
        memoryId,
        userId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
      })
      if (!memory) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(memory)
    }

    const members = (await server.workspaceService.listMembers({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })).filter(({ principal }) => principal.type === 'human' && principal.userId)
    const requestedMemberPrincipalId = request.nextUrl.searchParams.get('memberPrincipalId')?.trim()
    const requestedMember = requestedMemberPrincipalId
      ? members.find(({ principal }) => principal.id === requestedMemberPrincipalId)
      : undefined
    if (requestedMemberPrincipalId && !requestedMember?.principal.userId) {
      return NextResponse.json({ error: 'Workspace member not found' }, { status: 400 })
    }
    const updatedSinceValue = Number(request.nextUrl.searchParams.get('updatedSince'))
    const rows = await service.list({
      conversationId: request.nextUrl.searchParams.get('conversationId') ?? undefined,
      creatorUserId: requestedMember?.principal.userId,
      includeDeleted,
      noteId: request.nextUrl.searchParams.get('noteId') ?? undefined,
      projectId: request.nextUrl.searchParams.get('projectId') ?? undefined,
      scope: 'workspace',
      updatedSince: Number.isFinite(updatedSinceValue) && updatedSinceValue > 0 ? updatedSinceValue : undefined,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    const attributionsByUserId = new Map(members.map(({ principal }) => [
      principal.userId!,
      {
        email: principal.email,
        name: principal.displayName,
        principalId: principal.id,
      },
    ]))
    return NextResponse.json(raw ? rows : memoriesToClientListRows(rows, {
      attributionsByUserId,
      viewerUserId: context.auth.userId,
    }))
  } catch (error) {
    return memoryErrorResponse('GET', error)
  }
}

type MemoryBody = {
  actor?: MemoryActor
  clientId?: string
  content?: string
  conversationId?: string
  importance?: number
  memoryId?: string
  messageId?: string
  noteId?: string
  projectId?: string
  source?: MemorySource | string
  tags?: string[]
  turnId?: string
  type?: MemoryType
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as MemoryBody
    const result = await getOverlayServerContext().memoryService.create({
      ...body,
      content: body.content ?? '',
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({ id: result.ids[0], ...result })
  } catch (error) {
    return memoryErrorResponse('POST', error)
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as MemoryBody
    if (!body.memoryId?.trim()) return NextResponse.json({ error: 'memoryId and content required' }, { status: 400 })
    const memory = await getOverlayServerContext().memoryService.update({
      ...body,
      content: body.content ?? '',
      memoryId: body.memoryId.trim(),
      source: body.source as MemorySource | undefined,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({ memory, success: true })
  } catch (error) {
    return memoryErrorResponse('PATCH', error)
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    let body: MemoryBody = {}
    try {
      body = await request.json() as MemoryBody
    } catch (_error) {
      // Browser sends query params only.
    }
    const memoryId = body.memoryId ?? request.nextUrl.searchParams.get('memoryId') ?? undefined
    if (!memoryId) return NextResponse.json({ error: 'memoryId required' }, { status: 400 })
    const result = await getOverlayServerContext().memoryService.remove({
      memoryId,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return memoryErrorResponse('DELETE', error)
  }
}

function memoryErrorResponse(method: string, error: unknown) {
  logger.error(`[Memory API] ${method} error:`, error)
  if (error instanceof MemoryServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  return NextResponse.json({ error: 'Memory operation failed' }, { status: 500 })
}
