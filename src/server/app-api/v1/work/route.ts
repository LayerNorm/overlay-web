import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ConvexError } from 'convex/values'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkService, type WorkRepository } from '@/server/work/WorkService'
import { repositoryProxy } from '@/server/app-data/errors'
import { CreateWorkSchema, UpdateWorkSchema, WorkActionSchema, WorkQuerySchema } from '@/shared/work/schema'
import { publicEnv } from '@/shared/env/public-env'
import { logger } from '@/server/observability/logger'

const backendError = z.object({ code: z.enum(['INVALID', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT']), message: z.string() })
const statuses = { INVALID: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409 }
export function workError(error: unknown): NextResponse {
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const structured = backendError.safeParse(error instanceof ConvexError ? error.data : undefined)
  if (structured.success) return NextResponse.json({ error: structured.data.message, code: structured.data.code }, { status: statuses[structured.data.code] })
  logger.error('[Work] Request failed', error)
  return NextResponse.json({ error: 'Work is unavailable. Try again.' }, { status: 500 })
}
export function createWorkHandlers(service: WorkService) {
  const actor = (context: AppApiRouteContext) => ({ userId: context.auth.userId, workspaceId: context.workspace.workspace.id })
  const id = async (context: AppApiRouteContext) => z.string().min(1).max(200).parse((await context.params).id)
  return {
    async people(_request: NextRequest, context: AppApiRouteContext) {
      try { return NextResponse.json(await service.people(actor(context))) } catch (error) { return workError(error) }
    },
    async list(request: NextRequest, context: AppApiRouteContext) {
      try {
        const query = WorkQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams))
        return NextResponse.json(await service.list(actor(context), query.view))
      } catch (error) { return workError(error) }
    },
    async create(request: NextRequest, context: AppApiRouteContext) {
      try {
        const body = CreateWorkSchema.parse(await request.json())
        return NextResponse.json(await service.create(actor(context), body), { status: 201 })
      } catch (error) { return workError(error) }
    },
    async get(_request: NextRequest, context: AppApiRouteContext) {
      try {
        const taskId = await id(context)
        return NextResponse.json({ item: await service.get(actor(context), taskId), events: await service.events(actor(context), taskId) })
      } catch (error) { return workError(error) }
    },
    async update(request: NextRequest, context: AppApiRouteContext) {
      try { return NextResponse.json(await service.update(actor(context), await id(context), UpdateWorkSchema.parse(await request.json()))) }
      catch (error) { return workError(error) }
    },
    async action(request: NextRequest, context: AppApiRouteContext) {
      try {
        await service.action(actor(context), await id(context), WorkActionSchema.parse(await request.json()))
        return NextResponse.json({ success: true })
      } catch (error) { return workError(error) }
    },
    async archive(_request: NextRequest, context: AppApiRouteContext) {
      try {
        await service.action(actor(context), await id(context), { action: 'archived' })
        return NextResponse.json({ success: true })
      } catch (error) { return workError(error) }
    },
  }
}
const handlers = createWorkHandlers(new WorkService(repositoryProxy<WorkRepository>(() => getOverlayServerContext().appData.repositories.work)))
function gated(handler: (request: NextRequest, context: AppApiRouteContext) => Promise<NextResponse>) {
  return (request: NextRequest, context: AppApiRouteContext) => publicEnv.workEnabled
    ? handler(request, context) : Promise.resolve(NextResponse.json({ error: 'Not found' }, { status: 404 }))
}
export const GET = gated(handlers.list)
export const POST = gated(handlers.create)
export const getWork = gated(handlers.get)
export const updateWork = gated(handlers.update)
export const actionWork = gated(handlers.action)
export const archiveWork = gated(handlers.archive)

export const peopleWork = gated(handlers.people)
