import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedResourceUserId, getGrantedResources, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { repositoryProxy } from '@/server/app-data/errors'
import { NoteRevisionConflictError, NoteService, NoteServiceError, type NoteRepository } from '@/server/notes'
import type { CreateNoteRequest, UpdateNoteRequest } from '@overlay/app-core'

const noteService = new NoteService({
  billing: {
    getEntitlements: (userId) => getOverlayServerContext().billing.getEntitlements(userId),
  },
  noteRepository: repositoryProxy<NoteRepository>(
    () => getOverlayServerContext().appData.repositories.notes,
  ),
})

function readBooleanParam(value: string | null): boolean | undefined {
  if (value == null) return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
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

function toErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof NoteRevisionConflictError) {
    return NextResponse.json({
      success: false,
      note: null,
      error: error.message,
      conflict: {
        localRevision: error.expectedUpdatedAt === undefined ? undefined : String(error.expectedUpdatedAt),
        remoteRevision: String(error.currentUpdatedAt),
        message: error.message,
      },
    }, { status: 409 })
  }
  if (error instanceof NoteServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }

  logger.error(`[Notes API] ${fallbackMessage}:`, error)
  return NextResponse.json({ error: fallbackMessage }, { status: 500 })
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {

    const noteId = request.nextUrl.searchParams.get('noteId')
    if (noteId) {
      const note = await noteService.getNote({ noteId, userId: getAuthorizedResourceUserId(context) })
      if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(note)
    }

    const projectId = request.nextUrl.searchParams.get('projectId') ?? undefined
    const includeDeleted = readBooleanParam(request.nextUrl.searchParams.get('includeDeleted'))
    const notes = await noteService.listNotes({
      userId: getAuthorizedResourceUserId(context),
      projectId,
      includeDeleted,
    })
    const granted = await Promise.all(getGrantedResources(context).map(({ ownerUserId, resourceId }) => (
      noteService.getNote({ noteId: resourceId, userId: ownerUserId })
    )))
    return NextResponse.json([...notes, ...granted.filter((note) => (
      note && (!projectId || note.projectId === projectId)
    ))])
  } catch (error) {
    return toErrorResponse(error, 'Failed to fetch notes')
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await readJsonBody<CreateNoteRequest>(request, {})

    const result = await noteService.createNote({
      title: body.title,
      content: body.content,
      tags: body.tags,
      projectId: body.projectId,
      clientId: body.clientId,
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error, 'Failed to create note')
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await readJsonBody<Partial<UpdateNoteRequest>>(request, {})

    const result = await noteService.updateNote({
      noteId: body.noteId ?? '',
      title: body.title,
      content: body.content,
      tags: body.tags,
      projectId: body.projectId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error, 'Failed to update note')
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {

    const result = await noteService.deleteNote({
      noteId: request.nextUrl.searchParams.get('noteId'),
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error, 'Failed to delete note')
  }
}
