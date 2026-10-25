import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { parseMoveWorkItem } from '@/server/work'
import { NO_STORE, actingAgentPrincipalIdFrom, actorOf, jsonBody, workErrorResponse, workIdFrom, workService } from '../../shared'

/** POST /api/v1/work/{id}/move: drop a task into a column between two neighbours (the board). */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await jsonBody(request, context)
    const input = parseMoveWorkItem(body)
    const item = await workService().move({ ...actorOf(context), id: await workIdFrom(context), input, actingAgentPrincipalId: actingAgentPrincipalIdFrom(context, body) })
    return NextResponse.json({ item }, { headers: NO_STORE })
  } catch (error) {
    return workErrorResponse(error)
  }
}
