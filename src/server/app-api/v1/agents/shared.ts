import { NextResponse } from 'next/server'
import { WorkspaceAgentServiceError } from '@/server/agents'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'

export function agentErrorResponse(error: unknown) {
  if (error instanceof WorkspaceServiceError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
  }
  if (error instanceof WorkspaceAgentServiceError) {
    const status = error.code === 'not_found' ? 404
      : error.code === 'forbidden' ? 403
        : error.code === 'conflict' ? 409 : 400
    return NextResponse.json({ error: error.message, code: `agent_${error.code}` }, { status })
  }
  throw error
}
