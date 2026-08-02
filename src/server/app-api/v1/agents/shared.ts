import { NextResponse } from 'next/server'
import { WorkspaceAgentServiceError } from '@/server/agents'

export function agentErrorResponse(error: unknown) {
  if (error instanceof WorkspaceAgentServiceError) {
    const status = error.code === 'not_found' ? 404
      : error.code === 'forbidden' ? 403
        : error.code === 'conflict' ? 409 : 400
    return NextResponse.json({ error: error.message, code: `agent_${error.code}` }, { status })
  }
  throw error
}
