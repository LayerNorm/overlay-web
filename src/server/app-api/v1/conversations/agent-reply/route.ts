import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { logger } from '@/server/observability/logger'
import {
  invokeWorkspaceAgentsForHumanMessage,
  WorkspaceAgentInvocationError,
} from '@/server/agents/workspace-agent-invocation'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'

/**
 * Streams the agents' reply to a room message so the sender watches it arrive
 * in the bubble instead of waiting for a finished block of text. Persistence is
 * unchanged: the invocation stores the reply itself, and it is idempotent per
 * (message, agent), so a retry after a dropped connection cannot double-post.
 */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as {
      conversationId?: string
      messageId?: string
      mentionedPrincipalIds?: string[]
      threadRootMessageId?: string
    }
    const conversationId = body.conversationId?.trim()
    const messageId = body.messageId?.trim()
    if (!conversationId || !messageId) {
      return NextResponse.json({ error: 'conversationId and messageId are required' }, { status: 400 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch (_error) {
            // The client is gone; the invocation's abort signal ends the run.
          }
        }
        try {
          await invokeWorkspaceAgentsForHumanMessage({
            accessToken: context.auth.accessToken,
            actorUserId: context.auth.userId,
            workspaceId: context.workspace.workspace.id,
            conversationId,
            messageId,
            mentionedPrincipalIds: body.mentionedPrincipalIds,
            threadRootMessageId: body.threadRootMessageId,
            signal: request.signal,
            onDelta: (event) => send({ type: 'delta', ...event }),
          })
          send({ type: 'done' })
        } catch (error) {
          logger.error('[conversations/agent-reply]', error)
          if (error instanceof WorkspaceAgentInvocationError) {
            send({
              type: 'error',
              reasonCode: error.reasonCode,
              message: error.message,
            })
          } else {
            send({ type: 'error' })
          }
        } finally {
          try {
            controller.close()
          } catch (_error) {
            // Already closed by a disconnect.
          }
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    if (error instanceof WorkspaceServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    logger.error('[conversations/agent-reply]', error)
    return NextResponse.json({ error: 'Could not start the agent reply' }, { status: 500 })
  }
}
