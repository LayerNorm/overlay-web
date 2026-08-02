import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedResourceUserId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { repositoryProxy } from '@/server/app-data/errors'
import { handleRouteError } from '@/server/app-api/route-errors'
import { readValidatedJson, readValidatedQuery } from '@/server/app-api/validated-input'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  ProjectService,
  ProjectServiceError,
  type ProjectRepository,
} from '@/server/projects'
import {
  DuplicateProjectRequest,
  ProjectTemplateListQuery,
} from '@/shared/schemas/projects'

const projectService = new ProjectService(repositoryProxy<ProjectRepository>(
  () => getOverlayServerContext().appData.repositories.projects,
))

/** Lists projects marked as reusable templates. */
export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const queryResult = readValidatedQuery(request, context, ProjectTemplateListQuery)
    if (!queryResult.ok) return queryResult.response
    const templates = await projectService.listTemplates({
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json({ templates })
  } catch (error) {
    return duplicateError(error, 'GET', 'Failed to list project templates')
  }
}

/**
 * Creates a new project from an existing one's configuration. Working data is
 * never carried across; see ProjectService.duplicateProject.
 */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const bodyResult = await readValidatedJson(request, context, DuplicateProjectRequest)
    if (!bodyResult.ok) return bodyResult.response
    const { sourceProjectId, name } = bodyResult.data
    const userId = getAuthorizedResourceUserId(context)
    const server = getOverlayServerContext()

    const project = await projectService.duplicateProject({
      name,
      sourceProjectId,
      userId,
      attachKnowledgeBases: async ({ projectId }) => {
        const attached = await server.knowledgeBaseService.listProjectKnowledgeBases({
          projectId: sourceProjectId,
          userId,
        })
        for (const base of attached) {
          await server.knowledgeBaseService.attachProjectKnowledgeBase({
            knowledgeBaseId: base.id,
            projectId,
            userId,
          })
        }
      },
    })
    return NextResponse.json({ id: project._id, project })
  } catch (error) {
    return duplicateError(error, 'POST', 'Failed to duplicate project')
  }
}

function duplicateError(error: unknown, operation: string, clientMessage: string): NextResponse {
  if (error instanceof ProjectServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  return handleRouteError(error, { route: 'projects/duplicate', operation, clientMessage })
}
