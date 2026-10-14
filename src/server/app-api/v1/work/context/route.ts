import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { NO_STORE, actorOf, workErrorResponse, workService } from '../shared'

/** GET /api/v1/work/context: who is asking and the people and agents a task can be given to. */
export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    return NextResponse.json(await workService().context(actorOf(context)), { headers: NO_STORE })
  } catch (error) {
    return workErrorResponse(error)
  }
}
