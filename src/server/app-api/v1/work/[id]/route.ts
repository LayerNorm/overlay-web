import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { parseUpdateWorkItem } from '@/server/work'
import { NO_STORE, actingAgentPrincipalIdFrom, actorOf, jsonBody, workErrorResponse, workIdFrom, workService } from '../shared'

/** GET /api/v1/work/{id}: one task. */
export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const item = await workService().get({ ...actorOf(context), id: await workIdFrom(context) })
    return NextResponse.json({ item }, { headers: NO_STORE })
  } catch (error) {
    return workErrorResponse(error)
  }
}

/** DELETE /api/v1/work/{id}: deletes an archived task for good (Settings → Archived). Active tasks are archived first. */
export async function DELETE(_request: NextRequest, context: AppApiRouteContext) {
  try {
    await workService().remove({ ...actorOf(context), id: await workIdFrom(context) })
    return NextResponse.json({ success: true }, { headers: NO_STORE })
  } catch (error) {
    return workErrorResponse(error)
  }
}

/** PATCH /api/v1/work/{id}: change fields (null clears one). Moving between scopes and archiving use /api/v1/scope. */
export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await jsonBody(request, context)
    const input = parseUpdateWorkItem(body)
    const item = await workService().update({ ...actorOf(context), id: await workIdFrom(context), input, actingAgentPrincipalId: actingAgentPrincipalIdFrom(context, body) })
    return NextResponse.json({ item }, { headers: NO_STORE })
  } catch (error) {
    return workErrorResponse(error)
  }
}
