import type { NextRequest } from 'next/server'
import type { WorkspaceAccess } from '@overlay/workspace-contracts'
import type { AuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { ACTIVE_WORKSPACE_HEADER, ROUTE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import { readWorkspaceRouteTarget, type WorkspaceRouteTarget } from '@/shared/workspaces/routing'

type WorkspaceScopeService = {
  resolveActiveWorkspace(userId: string, workspaceId?: string): Promise<WorkspaceAccess>
  resolveWorkspaceHandle(args: { userId: string; handle: string }): Promise<{ workspaceId: string } | null>
}

export class UnavailableWorkspaceRouteError extends Error {
  constructor() {
    super('Workspace not found or you no longer have access.')
  }
}

type ParsedRouteTarget = {
  target: WorkspaceRouteTarget | null
  invalid: boolean
}

export async function resolveWorkspaceRequestScope(
  request: NextRequest,
  auth: AuthenticatedAppUser,
  service: WorkspaceScopeService,
): Promise<WorkspaceAccess> {
  const explicitWorkspaceId = explicitWorkspacePathTarget(request.nextUrl.pathname)
  if (explicitWorkspaceId === '') throw new UnavailableWorkspaceRouteError()

  let target: WorkspaceRouteTarget | null = null
  let routeScoped = explicitWorkspaceId !== null
  if (explicitWorkspaceId !== null) {
    target = { kind: 'id', value: explicitWorkspaceId }
  } else if (auth.authType === 'session') {
    const parsed = browserRouteTarget(request)
    if (parsed?.invalid) throw new UnavailableWorkspaceRouteError()
    target = parsed?.target ?? null
    routeScoped = target !== null
  }

  if (target) {
    try {
      const workspaceId = target.kind === 'id'
        ? target.value
        : (await service.resolveWorkspaceHandle({ userId: auth.userId, handle: target.value }))?.workspaceId
      if (!workspaceId) throw new UnavailableWorkspaceRouteError()
      return await service.resolveActiveWorkspace(auth.userId, workspaceId)
    } catch (_error) {
      throw new UnavailableWorkspaceRouteError()
    }
  }

  const requestedWorkspaceId = request.headers.get(ACTIVE_WORKSPACE_HEADER)?.trim() || undefined
  try {
    return await service.resolveActiveWorkspace(auth.userId, requestedWorkspaceId)
  } catch (error) {
    if (routeScoped || requestedWorkspaceId) throw new UnavailableWorkspaceRouteError()
    throw error
  }
}

function explicitWorkspacePathTarget(pathname: string): string | null {
  if (pathname === '/api/v1/workspaces/active') return null
  const match = /^\/api\/v1\/workspaces\/([^/]+)(?:\/|$)/.exec(pathname)
  if (!match) return null
  try {
    const workspaceId = decodeURIComponent(match[1] ?? '').trim()
    return workspaceId && !/[\/\\?#]/.test(workspaceId) ? workspaceId : ''
  } catch (_error) {
    return ''
  }
}

function browserRouteTarget(request: NextRequest): ParsedRouteTarget | null {
  const supplied = request.headers.get(ROUTE_WORKSPACE_HEADER)
  if (supplied !== null) {
    const separator = supplied.indexOf(':')
    const kind = supplied.slice(0, separator)
    const value = supplied.slice(separator + 1).trim()
    if (separator < 0 || !value) return { target: null, invalid: true }
    if (kind === 'id' && !/[\/\\?#]/.test(value)) {
      return { target: { kind: 'id', value }, invalid: false }
    }
    if (kind === 'handle') {
      const target = readWorkspaceRouteTarget(`/w/${encodeURIComponent(value)}`)
      if (target?.kind === 'handle') return { target, invalid: false }
    }
    return { target: null, invalid: true }
  }

  const referer = request.headers.get('referer')
  if (!referer) return null
  try {
    const url = new URL(referer)
    if (url.origin !== request.nextUrl.origin) return null
    if (!url.pathname.startsWith('/w/') && !url.pathname.startsWith('/app/w/')) return null
    const target = readWorkspaceRouteTarget(url.pathname)
    return target ? { target, invalid: false } : { target: null, invalid: true }
  } catch (_error) {
    return null
  }
}
