import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedResourceUserId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { handleRouteError } from '@/server/app-api/route-errors'
import { readValidatedJson } from '@/server/app-api/validated-input'
import { getOverlayServerContext } from '@/server/bootstrap'
import { KnowledgeBaseServiceError } from '@/server/knowledge-bases'
import { ProjectKnowledgeTransferRequest } from '@/shared/schemas/projects'

/**
 * Moves material between a project and a knowledge base. Always explicit: nothing
 * here happens as a side effect of ordinary project work.
 */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const bodyResult = await readValidatedJson(request, context, ProjectKnowledgeTransferRequest)
    if (!bodyResult.ok) return bodyResult.response
    const body = bodyResult.data
    const userId = getAuthorizedResourceUserId(context)
    const server = getOverlayServerContext()

    // Repositories are owner-scoped, so a missing project and someone else's
    // project are indistinguishable here by design.
    const project = await server.appData.repositories.projects.getProject({
      projectId: body.projectId,
      userId,
    })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    if (body.direction === 'promote') {
      const result = await server.projectKnowledgeTransferService.promoteProjectFileToKnowledgeBase({
        accessToken: context.auth.accessToken,
        fileId: body.fileId!,
        knowledgeBaseId: body.knowledgeBaseId,
        projectId: body.projectId,
        title: body.title,
        userId,
      })
      return NextResponse.json({ success: true, ...result }, { status: 202 })
    }

    const result = await server.projectKnowledgeTransferService.copyKnowledgeSourceToProject({
      knowledgeBaseId: body.knowledgeBaseId,
      projectId: body.projectId,
      sourceId: body.sourceId!,
      userId,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (error instanceof KnowledgeBaseServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return handleRouteError(error, {
      route: 'projects/knowledge-transfer',
      operation: 'POST',
      clientMessage: 'Failed to transfer between project and knowledge base',
    })
  }
}
