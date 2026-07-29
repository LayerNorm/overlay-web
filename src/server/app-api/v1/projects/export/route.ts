import { NextRequest, NextResponse } from 'next/server'
import type {
  ProjectExport,
  ProjectExportFile,
} from '@overlay/app-core'
import { getAuthorizedResourceUserId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { handleRouteError } from '@/server/app-api/route-errors'
import { readValidatedQuery } from '@/server/app-api/validated-input'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { FileRecord } from '@/server/files/FileRepository'
import { ProjectExportQuery } from '@/shared/schemas/projects'
import type { Id } from '../../../../../../convex/_generated/dataModel'

const FILE_EXPORT_FIELDS = [
  '_id',
  'name',
  'kind',
  'content',
  'textContent',
  'mimeType',
  'sizeBytes',
  'createdAt',
  'updatedAt',
] as const

/**
 * Produces a portable project archive without provider credentials or object
 * storage keys. Binary files remain represented by metadata; their bytes must
 * be downloaded separately through the authorized file APIs.
 */
export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const queryResult = readValidatedQuery(request, context, ProjectExportQuery)
    if (!queryResult.ok) return queryResult.response
    const { projectId } = queryResult.data
    const userId = getAuthorizedResourceUserId(context)
    const server = getOverlayServerContext()

    const project = await server.appData.repositories.projects.getProject({ projectId, userId })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const [conversationRows, notes, rawFiles, knowledgeBases] = await Promise.all([
      server.appData.repositories.conversations.listConversationsByProject({
        projectId,
        userId,
      }),
      server.noteRepository.listNotes({ projectId, userId }),
      server.appData.repositories.files.listFiles({ projectId, userId }),
      server.knowledgeBaseService.listProjectKnowledgeBases({ projectId, userId }),
    ])
    const conversations = await Promise.all(conversationRows.map(async (conversation) => ({
      ...conversation,
      messages: await server.appData.repositories.conversations.getConversationMessages({
        conversationId: conversation._id as Id<'conversations'>,
        userId,
      }),
    })))

    const payload: ProjectExport = {
      format: 'overlay-project',
      version: 1,
      exportedAt: new Date().toISOString(),
      project,
      knowledgeBases: knowledgeBases.map(({ id, title, description }) => ({
        id,
        title,
        description,
      })),
      conversations,
      notes: notes.map((note) => ({
        _id: note._id,
        title: note.name,
        content: note.textContent ?? note.content ?? '',
        tags: note.tags ?? [],
        projectId: note.projectId,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        deletedAt: note.deletedAt,
        clientId: note.clientId,
      })),
      files: rawFiles.map((file) => exportFile(file as FileRecord)),
    }
    return NextResponse.json(payload, {
      headers: {
        'Content-Disposition': `attachment; filename="${safeFilename(project.name)}.overlay.json"`,
      },
    })
  } catch (error) {
    return handleRouteError(error, {
      route: 'projects/export',
      operation: 'GET',
      clientMessage: 'Failed to export project',
    })
  }
}

function exportFile(file: FileRecord): ProjectExportFile {
  const output: Record<string, unknown> = {}
  for (const key of FILE_EXPORT_FIELDS) {
    if (file[key] !== undefined) output[key === '_id' ? 'id' : key] = file[key]
  }
  return output as unknown as ProjectExportFile
}

function safeFilename(name: string): string {
  return (name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project')
    .slice(0, 120)
}
