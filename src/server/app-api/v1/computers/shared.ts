import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { ComputerActor } from '@/server/computers/ComputerService'
import { ComputerServiceError } from '@/server/computers/ComputerService'
import { logger } from '@/server/observability/logger'

export function computerErrorResponse(error: unknown) {
  if (error instanceof ComputerServiceError) {
    return NextResponse.json({ error: error.message, code: error.code }, {
      status: error.status,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  logger.error('[computers] request failed', error)
  return NextResponse.json({ error: 'Computer request failed', code: 'internal_error' }, {
    status: 500,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function computerIdFrom(context: { params: Promise<Record<string, string | string[]>> }) {
  const value = (await context.params).computerId
  const computerId = typeof value === 'string' ? value.trim() : ''
  if (!computerId) throw new ComputerServiceError('not_found', 'Computer id is required', 400)
  return computerId
}

export function actorFrom(context: AppApiRouteContext): ComputerActor {
  return {
    userId: context.auth.userId,
    principalId: context.workspace.principal.id,
    workspaceRole: context.workspace.membership.role === 'owner' ? 'owner' : 'member',
  }
}
