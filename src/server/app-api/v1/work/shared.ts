import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { logger } from '@/server/observability/logger'
import { WorkInputError, WorkServiceError, getWorkService, translateWorkError } from '@/server/work'

export const NO_STORE = { 'Cache-Control': 'no-store' } as const

export function workErrorResponse(error: unknown) {
  if (error instanceof WorkInputError) {
    return NextResponse.json({ error: error.message, code: 'validation_error' }, { status: 400, headers: NO_STORE })
  }
  const translated = translateWorkError(error)
  if (translated instanceof WorkServiceError) {
    return NextResponse.json({ error: translated.message, code: translated.code }, { status: translated.statusCode, headers: NO_STORE })
  }
  logger.error('[work] request failed', error)
  return NextResponse.json({ error: 'Work request failed', code: 'internal_error' }, { status: 500, headers: NO_STORE })
}

export function actorOf(context: AppApiRouteContext) {
  return { userId: context.auth.userId, workspaceId: context.workspace.workspace.id }
}

export async function workIdFrom(context: AppApiRouteContext): Promise<string> {
  const value = (await context.params).id
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id) throw new WorkInputError('Task id is required.')
  return id
}

export async function jsonBody(request: Request, context: AppApiRouteContext): Promise<unknown> {
  if (Object.keys(context.parsedJson).length > 0) return context.parsedJson
  try {
    return await request.json()
  } catch (_error) {
    return {}
  }
}

export const workService = getWorkService
