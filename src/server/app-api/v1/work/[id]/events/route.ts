import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { parseAddWorkComment } from '@/server/work'
import { NO_STORE, actingAgentPrincipalIdFrom, actorOf, jsonBody, workErrorResponse, workIdFrom, workService } from '../../shared'

/** GET /api/v1/work/{id}/events: a task's activity and comments, oldest first. */
export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const events = await workService().listEvents({ ...actorOf(context), id: await workIdFrom(context) })
    return NextResponse.json({ events }, { headers: NO_STORE })
  } catch (error) {
    return workErrorResponse(error)
  }
}

/** POST /api/v1/work/{id}/events: add a comment. */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const json = await jsonBody(request, context)
    const { body } = parseAddWorkComment(json)
    await workService().addComment({ ...actorOf(context), id: await workIdFrom(context), body, actingAgentPrincipalId: actingAgentPrincipalIdFrom(context, json) })
    return NextResponse.json({ success: true }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return workErrorResponse(error)
  }
}
