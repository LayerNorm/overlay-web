import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { AgentAskError } from '@/server/agents/agent-asks/AgentAskService'
import { logger } from '@/server/observability/logger'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Extra keys are ignored on purpose: tool calls carry their own auth fields alongside these.
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), callerAgentId: z.string().max(80).optional() }),
  z.object({
    action: z.literal('ask'),
    agent: z.string().min(1).max(200),
    message: z.string().min(1).max(8_000),
    wait: z.boolean().optional(),
    // Absent when an outside app asks for the person; all three are present when an agent asks.
    callerAgentId: z.string().min(1).max(80).optional(),
    callerConversationId: z.string().min(1).max(80).optional(),
    callerTurnId: z.string().min(1).max(300).optional(),
  }),
  z.object({
    action: z.literal('post'),
    conversationId: z.string().min(1).max(80),
    text: z.string().min(1).max(8_000),
    mentions: z.array(z.string().min(1).max(200)).max(3).optional(),
    callerAgentId: z.string().min(1).max(80),
    callerConversationId: z.string().min(1).max(80),
    callerTurnId: z.string().min(1).max(300),
  }),
  z.object({ action: z.literal('read'), conversationId: z.string().min(1).max(80), turnId: z.string().min(1).max(300) }),
])

/**
 * What agents use to ask each other: list who can be asked, ask one (waiting for the reply or not), post a message
 * into a conversation (mentioning agents there), and read a reply that was still being written. An outside app
 * asks the same way, without an agent identity, as the person. The caller is the person; the agent asking is named in the body by the tool
 * that runs inside the agent's own turn, and is checked against that turn (see AgentAskService).
 */
export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const input = bodySchema.parse(context.parsedJson)
    const asks = getOverlayServerContext().agentAsks
    const base = { actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id }
    switch (input.action) {
      case 'list':
        return NextResponse.json({ agents: await asks.list({ ...base, ...(input.callerAgentId ? { callerAgentId: input.callerAgentId } : {}) }) }, { headers: NO_STORE })
      case 'ask': {
        // An agent asking names itself; an outside app has no agent, whatever turn fields its tool context carries.
        if (input.callerAgentId && (!input.callerConversationId || !input.callerTurnId)) {
          throw new AgentAskError('That request is not valid.', 400, 'validation')
        }
        return NextResponse.json(await asks.ask({
          ...base,
          actorPrincipalId: context.workspace.principal.id,
          ...(input.callerAgentId
            ? { caller: { agentId: input.callerAgentId, conversationId: input.callerConversationId!, turnId: input.callerTurnId! } }
            : {}),
          target: input.agent,
          message: input.message,
          wait: input.wait !== false,
        }), { headers: NO_STORE })
      }
      case 'post':
        return NextResponse.json(await asks.post({
          ...base,
          actorPrincipalId: context.workspace.principal.id,
          caller: { agentId: input.callerAgentId, conversationId: input.callerConversationId, turnId: input.callerTurnId },
          conversationId: input.conversationId,
          text: input.text,
          mentions: input.mentions ?? [],
        }), { headers: NO_STORE })
      case 'read':
        return NextResponse.json(await asks.read({ ...base, conversationId: input.conversationId, turnId: input.turnId }), { headers: NO_STORE })
    }
  } catch (error) {
    if (error instanceof AgentAskError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode, headers: NO_STORE })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'That request is not valid.', code: 'validation' }, { status: 400, headers: NO_STORE })
    }
    logger.error('[agent-asks] request failed', { detail: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : 'unknown' })
    return NextResponse.json({ error: 'Could not complete the request.', code: 'internal_error' }, { status: 500, headers: NO_STORE })
  }
}
