import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { handleRouteError } from '@/server/app-api/route-errors'
import { readValidatedJson, readValidatedQuery } from '@/server/app-api/validated-input'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import {
  CreateProjectRequest,
  DeleteProjectRequest,
  ProjectListQuery,
  UpdateProjectRequest,
} from '@/shared/schemas/projects'
import type { Id } from '../../../../../convex/_generated/dataModel'

type ProjectDoc = {
  _id: string
  userId: string
  clientId?: string
  name: string
  instructions?: string
  parentId?: string | null
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

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
    const serverSecret = getInternalApiSecret()
    const projectId = query.projectId ?? null

    if (projectId) {
      const project = await convex.query<ProjectDoc | null>('projects/projects:get', {
        projectId: projectId as Id<'projects'>,
        userId: auth.userId,
        serverSecret,
      })
      if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(project)
    }

    const updatedSinceParam = query.updatedSince
    const updatedSince = updatedSinceParam ? Number(updatedSinceParam) : undefined
    const includeDeleted = readBooleanParam(query.includeDeleted ?? null)

    const projects = await convex.query<ProjectDoc[]>('projects/projects:list', {
      userId: auth.userId,
      serverSecret,
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
    const serverSecret = getInternalApiSecret()
    const { name, parentId, instructions, clientId } = body
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const id = await convex.mutation<Id<'projects'>>('projects/projects:create', {
      userId: auth.userId,
      serverSecret,
      clientId: clientId?.trim() || undefined,
      name,
      instructions: instructions?.trim() || undefined,
      parentId: parentId ?? undefined,
    })
    const project = await convex.query<ProjectDoc | null>('projects/projects:get', {
      projectId: id,
      userId: auth.userId,
      serverSecret,
    })
    return NextResponse.json({ id, project })
  } catch (error) {
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
    const serverSecret = getInternalApiSecret()
    const { projectId, name, instructions, parentId } = body
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    await convex.mutation('projects/projects:update', {
      projectId: projectId as Id<'projects'>,
      userId: auth.userId,
      serverSecret,
      name,
      instructions,
      parentId: parentId ?? undefined,
    })
    const project = await convex.query<ProjectDoc | null>('projects/projects:get', {
      projectId: projectId as Id<'projects'>,
      userId: auth.userId,
      serverSecret,
    })
    return NextResponse.json({ success: true, project })
  } catch (error) {
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
    const serverSecret = getInternalApiSecret()
    const projectId = query.projectId ?? null
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

    // Cascade delete child projects first (Convex mutation handles each project's items)
    const allProjects = await convex.query<Array<{ _id: string; parentId?: string; deletedAt?: number }>>('projects/projects:list', {
      userId: auth.userId,
      serverSecret,
      includeDeleted: true,
    })
    const toDelete = collectDescendants(allProjects || [], projectId)
    // Delete leaves first (reverse order so children before parents)
    for (const id of toDelete.reverse()) {
      await convex.mutation('projects/projects:remove', {
        projectId: id as Id<'projects'>,
        userId: auth.userId,
        serverSecret,
      })
    }
    return NextResponse.json({ success: true, deletedIds: toDelete, deletedAt: Date.now() })
  } catch (error) {
    return handleRouteError(error, {
      route: 'projects',
      operation: 'DELETE',
      clientMessage: 'Failed to delete project',
    })
  }
}

function collectDescendants(
  projects: Array<{ _id: string; parentId?: string }>,
  rootId: string,
): string[] {
  const result: string[] = [rootId]
  const seen = new Set<string>(result)
  for (let index = 0; index < result.length; index += 1) {
    const current = result[index]!
    const children = projects.filter((p) => p.parentId === current)
    for (const child of children) {
      if (seen.has(child._id)) continue
      seen.add(child._id)
      result.push(child._id)
    }
  }
  return result
}
