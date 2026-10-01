import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { SurfaceActor } from '@/server/surfaces/SurfaceService'
import { SurfaceServiceError } from '@/server/surfaces/SurfaceService'
import { logger } from '@/server/observability/logger'

export function surfaceErrorResponse(error: unknown) {
  if (error instanceof SurfaceServiceError) {
    if (error.status >= 500) {
      logger.error(`[surfaces] ${error.code}: ${error.message}`, error.cause ?? error)
    }
    return NextResponse.json({ error: error.message, code: error.code }, {
      status: error.status,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  logger.error('[surfaces] request failed', error)
  return NextResponse.json({ error: 'Surface request failed', code: 'internal_error' }, {
    status: 500,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export function surfaceActorFrom(context: AppApiRouteContext): SurfaceActor {
  return {
    userId: context.auth.userId,
    principalId: context.workspace.principal.id,
    workspaceRole: context.workspace.membership.role,
  }
}

export async function surfaceParamId(
  context: { params: Promise<Record<string, string | string[]>> },
  key: string,
): Promise<string> {
  const value = (await context.params)[key]
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id) throw new SurfaceServiceError('not_found', 'Surface resource id is required', 400)
  return id
}
