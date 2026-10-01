import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceAgentServiceError } from '@/server/agents'
import { agentErrorResponse } from '../../../shared'

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  try {
    const params = await context.params
    const agentId = requiredParam(params.agentId, 'Agent ID')
    const threadId = requiredParam(params.threadId, 'Thread ID')
    const body = (context.parsedJson ?? {}) as Record<string, unknown>
    if (typeof body.archived !== 'boolean') {
      throw new WorkspaceAgentServiceError('validation', 'archived must be a boolean')
    }
    await getOverlayServerContext().workspaceAgentService.setThreadArchived({
      actorUserId: context.auth.userId,
      agentId,
      conversationId: threadId,
      archived: body.archived,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return agentErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    const params = await context.params
    const agentId = requiredParam(params.agentId, 'Agent ID')
    const threadId = requiredParam(params.threadId, 'Thread ID')
    await getOverlayServerContext().workspaceAgentService.deleteThread({
      actorUserId: context.auth.userId,
      agentId,
      conversationId: threadId,
    })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    return agentErrorResponse(error)
  }
}

function requiredParam(value: string | string[] | undefined, label: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WorkspaceAgentServiceError('validation', `${label} is required`)
  }
  return value.trim()
}
