import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { parseCreateWorkItem } from '@/server/work'
import { parseResourceView } from '@/shared/workspaces/resource-scope'
import { NO_STORE, actingAgentPrincipalIdFrom, actorOf, jsonBody, workErrorResponse, workService } from './shared'

/** GET /api/v1/work?view=personal|workspace|archived: the tasks the caller can see, in board order. */
export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const items = await workService().list({
      ...actorOf(context),
      view: parseResourceView(request.nextUrl.searchParams.get('view')),
    })
    return NextResponse.json({ items }, { headers: NO_STORE })
  } catch (error) {
    return workErrorResponse(error)
  }
}

/** POST /api/v1/work: create a task. */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await jsonBody(request, context)
    const input = parseCreateWorkItem(body)
    const item = await workService().create({ ...actorOf(context), input, actingAgentPrincipalId: actingAgentPrincipalIdFrom(context, body) })
    return NextResponse.json({ item }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return workErrorResponse(error)
  }
}
