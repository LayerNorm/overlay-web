import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceAgentServiceError } from '@/server/agents'
import { agentErrorResponse } from '../../shared'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const agentId = requiredAgentId(await context.params)
    const bundle = await getOverlayServerContext().workspaceAgentService.listBundle({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      agentId,
    })
    return NextResponse.json({ automations: bundle.automations })
  } catch (error) {
    return agentErrorResponse(error)
  }
}

function requiredAgentId(params: Record<string, string | string[]>) {
  const value = params.agentId
  if (typeof value !== 'string' || !value.trim()) {
    throw new WorkspaceAgentServiceError('validation', 'Agent ID is required')
  }
  return value.trim()
}
