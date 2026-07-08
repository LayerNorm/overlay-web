import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { repositoryProxy } from '@/server/app-data/errors'
import { NoteService, NoteServiceError, type NoteRepository } from '@/server/notes'
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
  if (error instanceof NoteServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }

  logger.error(`[Notes API] ${fallbackMessage}:`, error)
  return NextResponse.json({ error: fallbackMessage }, { status: 500 })
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context

    const noteId = request.nextUrl.searchParams.get('noteId')
    if (noteId) {
      const note = await noteService.getNote({ noteId, userId: auth.userId })
      if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(note)
    }

    const projectId = request.nextUrl.searchParams.get('projectId') ?? undefined
    const includeDeleted = readBooleanParam(request.nextUrl.searchParams.get('includeDeleted'))
    const notes = await noteService.listNotes({
      userId: auth.userId,
      projectId,
      includeDeleted,
    })
    return NextResponse.json(notes)
  } catch (error) {
    return toErrorResponse(error, 'Failed to fetch notes')
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await readJsonBody<CreateNoteRequest>(request, {})
    const { auth } = context

    const result = await noteService.createNote({
      title: body.title,
      content: body.content,
      projectId: body.projectId,
      userId: auth.userId,
    })
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error, 'Failed to create note')
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await readJsonBody<Partial<UpdateNoteRequest>>(request, {})
    const { auth } = context

    const result = await noteService.updateNote({
      noteId: body.noteId ?? '',
      title: body.title,
      content: body.content,
      projectId: body.projectId,
      userId: auth.userId,
    })
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error, 'Failed to update note')
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context

    const result = await noteService.deleteNote({
      noteId: request.nextUrl.searchParams.get('noteId'),
      userId: auth.userId,
    })
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error, 'Failed to delete note')
  }
}
