import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
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
  CreateProjectRequest,
  DeleteProjectRequest,
  ProjectListQuery,
  UpdateProjectRequest,
} from '@/shared/schemas/projects'
const projectService = new ProjectService(repositoryProxy<ProjectRepository>(
  () => getOverlayServerContext().appData.repositories.projects,
))

function readBooleanParam(value: string | null): boolean | undefined {
  if (value == null) return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const queryResult = readValidatedQuery(request, context, ProjectListQuery)
    if (!queryResult.ok) return queryResult.response
    const query = queryResult.data
    const { auth } = context
    const projectId = query.projectId ?? null

    if (projectId) {
      const project = await projectService.getProject({
        projectId,
        userId: auth.userId,
      })
      if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(project)
    }

    const updatedSinceParam = query.updatedSince
    const updatedSince = updatedSinceParam ? Number(updatedSinceParam) : undefined
    const includeDeleted = readBooleanParam(query.includeDeleted ?? null)

    const projects = await projectService.listProjects({
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
      ...(Number.isFinite(updatedSince) ? { updatedSince } : {}),
      ...(includeDeleted !== undefined ? { includeDeleted } : {}),
    })
    return NextResponse.json(projects || [])
  } catch (error) {
    return handleRouteError(error, {
      route: 'projects',
      operation: 'GET',
      clientMessage: 'Failed to fetch projects',
    })
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const bodyResult = await readValidatedJson(request, context, CreateProjectRequest)
    if (!bodyResult.ok) return bodyResult.response
    const body = bodyResult.data
    const { auth } = context
    const { name, parentId, instructions, clientId } = body
    const project = await projectService.createProject({
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
      clientId: clientId?.trim() || undefined,
      name,
      instructions: instructions?.trim() || undefined,
      parentId,
    })
    return NextResponse.json({ id: project._id, project })
  } catch (error) {
    if (error instanceof ProjectServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return handleRouteError(error, {
      route: 'projects',
      operation: 'POST',
      clientMessage: 'Failed to create project',
    })
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const bodyResult = await readValidatedJson(request, context, UpdateProjectRequest)
    if (!bodyResult.ok) return bodyResult.response
    const body = bodyResult.data
    const { auth } = context
    const { projectId, name, instructions, parentId } = body
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    const project = await projectService.updateProject({
      projectId,
      userId: auth.userId,
      name,
      instructions,
      parentId,
    })
    return NextResponse.json({ success: true, project })
  } catch (error) {
    if (error instanceof ProjectServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return handleRouteError(error, {
      route: 'projects',
      operation: 'PATCH',
      clientMessage: 'Failed to update project',
    })
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const queryResult = readValidatedQuery(request, context, DeleteProjectRequest)
    if (!queryResult.ok) return queryResult.response
    const query = queryResult.data
    const { auth } = context
    const projectId = query.projectId ?? null
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    const result = await projectService.deleteProjectTree({
      projectId,
      userId: auth.userId,
    })
    return NextResponse.json({
      success: true,
      deletedIds: result.deletedIds,
      deletedAt: result.deletedAt,
    })
  } catch (error) {
    if (error instanceof ProjectServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return handleRouteError(error, {
      route: 'projects',
      operation: 'DELETE',
      clientMessage: 'Failed to delete project',
    })
  }
}
