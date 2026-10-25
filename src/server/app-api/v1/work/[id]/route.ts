import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { parseUpdateWorkItem, translateWorkError, WorkServiceError } from '@/server/work'
import { recordScopeAudit } from '@/server/workspaces/scope-audit'
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

/** PATCH /api/v1/work/{id}: atomically change fields, status and scope; expectedUpdatedAt guards against stale edits. */
export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  let scopeMove: { id: string; to: 'personal' | 'workspace' } | undefined
  try {
    const body = await jsonBody(request, context)
    const input = parseUpdateWorkItem(body)
    const id = await workIdFrom(context)
    if (input.scope !== undefined) scopeMove = { id, to: input.scope }
    const item = await workService().update({ ...actorOf(context), id, input, actingAgentPrincipalId: actingAgentPrincipalIdFrom(context, body) })
    if (scopeMove) await recordScopeAudit({ context, resource: 'work', action: 'move', ...scopeMove, outcome: { ok: true } })
    return NextResponse.json({ item }, { headers: NO_STORE })
  } catch (error) {
    if (scopeMove) {
      const translated = translateWorkError(error)
      await recordScopeAudit({ context, resource: 'work', action: 'move', ...scopeMove, outcome: { ok: false, reason: translated instanceof WorkServiceError ? translated.code : 'internal_error' } })
    }
    return workErrorResponse(error)
  }
}
