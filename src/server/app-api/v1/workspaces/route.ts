import { NextResponse } from 'next/server'
import type {
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceListResponse,
} from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'
import { toWorkspaceSummary } from './presentation'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const service = getOverlayServerContext().workspaceService
    await service.ensurePersonalWorkspace({
      userId: context.auth.userId,
      displayName: context.auth.profile?.displayName,
      email: context.auth.profile?.email,
    })
    const [accesses, active] = await Promise.all([
      service.listForUser(context.auth.userId),
      service.resolveActiveWorkspace(context.auth.userId),
    ])
    const workspaces = await Promise.all(accesses.map(async (access) => {
      const memberCount = await service.countMembers({
        actorUserId: context.auth.userId,
        workspaceId: access.workspace.id,
      })
      return toWorkspaceSummary(access, { memberCount })
    }))
    const response: WorkspaceListResponse = {
      workspaces,
      activeWorkspaceId: active.workspace.id,
    }
    return NextResponse.json(response)
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to load workspaces')
  }
}

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const input = parseCreateInput(context.parsedJson)
    const service = getOverlayServerContext().workspaceService
    const access = await service.createOrganization({
      actorUserId: context.auth.userId,
      name: input.name,
      slug: input.slug,
      displayName: context.auth.profile?.displayName,
      email: context.auth.profile?.email,
    })
    await service.setActiveWorkspace(context.auth.userId, access.workspace.id)
    const response: WorkspaceCreateResponse = {
      workspace: toWorkspaceSummary(access, { memberCount: 1 }),
    }
    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to create workspace')
  }
}

function parseCreateInput(value: Record<string, unknown>): WorkspaceCreateInput {
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const slug = typeof value.slug === 'string' ? value.slug.trim() : undefined
  if (!name || name.length > 80) {
    throw new WorkspaceServiceError(
      'Workspace name must be between 1 and 80 characters',
      400,
      'validation',
    )
  }
  if (slug !== undefined && slug.length > 63) {
    throw new WorkspaceServiceError(
      'Workspace slug must be at most 63 characters',
      400,
      'validation',
    )
  }
  return { name, ...(slug ? { slug } : {}) }
}

export function workspaceErrorResponse(error: unknown, fallback: string) {
  if (error instanceof WorkspaceServiceError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode },
    )
  }
  return NextResponse.json(
    { error: fallback, code: 'workspace_operation_failed' },
    { status: 500 },
  )
}
