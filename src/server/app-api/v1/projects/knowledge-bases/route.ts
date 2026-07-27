import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedResourceUserId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { handleRouteError } from '@/server/app-api/route-errors'
import { readValidatedJson, readValidatedQuery } from '@/server/app-api/validated-input'
import { getOverlayServerContext } from '@/server/bootstrap'
import { KnowledgeBaseServiceError } from '@/server/knowledge-bases'
import {
  AttachProjectKnowledgeBaseRequest,
  DetachProjectKnowledgeBaseRequest,
  ProjectKnowledgeBaseListQuery,
} from '@/shared/schemas/projects'

/**
 * Confirms the caller owns the project before its knowledge attachments can be
 * read or changed. Repositories are owner-scoped, so a missing project and a
 * project owned by someone else are indistinguishable here by design.
 */
async function requireOwnedProject(projectId: string, userId: string): Promise<void> {
  const project = await getOverlayServerContext().appData.repositories.projects.getProject({
    projectId,
    userId,
  })
  if (!project) throw new KnowledgeBaseServiceError('Project not found', 404)
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const queryResult = readValidatedQuery(request, context, ProjectKnowledgeBaseListQuery)
    if (!queryResult.ok) return queryResult.response
    const projectId = queryResult.data.projectId
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    const userId = getAuthorizedResourceUserId(context)
    await requireOwnedProject(projectId, userId)
    const knowledgeBases = await getOverlayServerContext().knowledgeBaseService
      .listProjectKnowledgeBases({ projectId, userId })
    return NextResponse.json({ knowledgeBases })
  } catch (error) {
    return knowledgeAttachmentError(error, 'GET', 'Failed to list project knowledge bases')
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const bodyResult = await readValidatedJson(request, context, AttachProjectKnowledgeBaseRequest)
    if (!bodyResult.ok) return bodyResult.response
    const { projectId, knowledgeBaseId } = bodyResult.data
    const userId = getAuthorizedResourceUserId(context)
    await requireOwnedProject(projectId, userId)
    const attachment = await getOverlayServerContext().knowledgeBaseService
      .attachProjectKnowledgeBase({ knowledgeBaseId, projectId, userId })
    return NextResponse.json({ success: true, attachment })
  } catch (error) {
    return knowledgeAttachmentError(error, 'POST', 'Failed to attach project knowledge base')
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const queryResult = readValidatedQuery(request, context, DetachProjectKnowledgeBaseRequest)
    if (!queryResult.ok) return queryResult.response
    const { projectId, knowledgeBaseId } = queryResult.data
    const userId = getAuthorizedResourceUserId(context)
    await requireOwnedProject(projectId, userId)
    await getOverlayServerContext().knowledgeBaseService
      .detachProjectKnowledgeBase({ knowledgeBaseId, projectId })
    return NextResponse.json({ success: true })
  } catch (error) {
    return knowledgeAttachmentError(error, 'DELETE', 'Failed to detach project knowledge base')
  }
}

function knowledgeAttachmentError(
  error: unknown,
  operation: string,
  clientMessage: string,
): NextResponse {
  if (error instanceof KnowledgeBaseServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  return handleRouteError(error, {
    route: 'projects/knowledge-bases',
    operation,
    clientMessage,
  })
}
