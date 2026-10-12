import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { repositoryProxy } from '@/server/app-data/errors'
import { NoteService, type NoteRepository } from '@/server/notes'
import { toErrorResponse } from '../route'

const noteService = new NoteService({
  billing: {
    getEntitlements: (userId) =>
      getOverlayServerContext().billing.getEntitlements(userId),
  },
  noteRepository: repositoryProxy<NoteRepository>(
    () => getOverlayServerContext().appData.repositories.notes,
  ),
})

export async function GET(
  request: NextRequest,
  context: AppApiRouteContext,
) {
  try {
    const noteId = request.nextUrl.searchParams.get('noteId')
    if (!noteId) {
      return NextResponse.json({ error: 'noteId required' }, { status: 400 })
    }
    const versions = await noteService.listNoteVersions({
      noteId,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      limit: 50,
    })
    return NextResponse.json(versions)
  } catch (error) {
    return toErrorResponse(error, 'Failed to fetch note versions')
  }
}
