import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceAgentServiceError } from '@/server/agents/WorkspaceAgentService'

const GREETING_TEXT = 'Hi! What do you want to call me, and what should I work on?'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as Partial<{ conversationId: string; agentId: string }>
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
    if (!conversationId || !agentId) {
      return NextResponse.json({ error: 'conversationId and agentId are required' }, { status: 400 })
    }
    const server = getOverlayServerContext()
    const workspaceId = context.workspace.workspace.id
    // Visibility-enforced: creator-only agents stay invisible to other members.
    const agent = await server.workspaceAgentService.get({
      actorUserId: context.auth.userId,
      workspaceId,
      agentId,
    })
    const conversation = await server.appData.repositories.conversationCollaboration.getAccessibleConversation({
      actorUserId: context.auth.userId,
      conversationId,
      workspaceId,
    })
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    const messageId = await server.appData.repositories.conversationCollaboration.addAgentMessage({
      actorUserId: context.auth.userId,
      authorPrincipalId: agent.principalId,
      clientNonce: `greeting:${conversationId}:${agent.principalId}`,
      content: GREETING_TEXT,
      conversationId,
      modelId: agent.modelId,
      turnId: `agent_greeting_${agent.id}`,
      workspaceId,
    })
    return NextResponse.json({ messageId })
  } catch (error) {
    if (error instanceof WorkspaceAgentServiceError && error.code === 'not_found') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Could not post the greeting' }, { status: 500 })
  }
}
