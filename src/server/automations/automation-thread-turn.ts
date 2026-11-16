import 'server-only'

import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { executeActTurn } from '@/server/app-api/v1/conversations/act/ActTurnOrchestrationService'
import { startWorkspaceAgentTurns } from '@/server/agents/start-agent-turns'
import { getOverlayServerContext } from '@/server/bootstrap'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import type { AutomationThreadTurnInput } from './AutomationService'

type ServerContext = ReturnType<typeof getOverlayServerContext>

export type AutomationThreadTurnDependencies = {
  server?: () => ServerContext
  startAgentTurns?: typeof startWorkspaceAgentTurns
  executeChatTurn?: typeof executeActTurn
}

/**
 * Posts an automation run's instructions into its thread as an ordinary user
 * message and starts the turn through the same entry point that thread's
 * composer uses: `/api/v1/conversations/message` for agent threads and
 * `/api/v1/conversations/act` for chats. The turn runs with the thread's own
 * prompt, persona, tools and memory; questions and approvals wait in the
 * thread for the owner like any other turn.
 */
export async function startAutomationThreadTurn(
  input: AutomationThreadTurnInput,
  dependencies: AutomationThreadTurnDependencies = {},
): Promise<{ messageId: string }> {
  const server = (dependencies.server ?? getOverlayServerContext)()
  const workspace = await server.workspaceService.resolveActiveWorkspace(input.userId, input.thread.workspaceId)
  if (workspace.workspace.id !== input.thread.workspaceId) {
    throw new Error('The automation owner no longer has access to its workspace.')
  }
  await server.workspaceGovernanceService.assertWithinLimits({
    action: 'message.send',
    scope: { workspaceId: workspace.workspace.id, principalId: workspace.principal.id, conversationId: input.thread.conversationId },
  })
  const routeContext: AppApiRouteContext = { ...input.routeContext, workspace }
  return input.thread.kind === 'agent'
    ? await startAgentThreadTurn(input, routeContext, server, dependencies)
    : await startChatThreadTurn(input, routeContext, server, dependencies)
}

async function startAgentThreadTurn(
  input: AutomationThreadTurnInput,
  routeContext: AppApiRouteContext,
  server: ServerContext,
  dependencies: AutomationThreadTurnDependencies,
): Promise<{ messageId: string }> {
  const messageId = await server.appData.repositories.conversationCollaboration.addMessage({
    actorUserId: input.userId,
    conversationId: input.thread.conversationId,
    workspaceId: routeContext.workspace.workspace.id,
    turnId: input.turnId,
    clientNonce: input.turnId,
    content: input.instructions,
    parts: [{ type: 'text', text: input.instructions }],
  })
  await (dependencies.startAgentTurns ?? startWorkspaceAgentTurns)({
    actorUserId: input.userId,
    conversationId: input.thread.conversationId,
    initiatorPrincipalId: routeContext.workspace.principal.id,
    mentionedPrincipalIds: [],
    messageId: String(messageId),
    prompt: input.instructions,
    memoryEnabled: true,
    turnId: input.turnId,
    workspaceId: routeContext.workspace.workspace.id,
    strictErrors: true,
  })
  return { messageId: String(messageId) }
}

async function startChatThreadTurn(
  input: AutomationThreadTurnInput,
  routeContext: AppApiRouteContext,
  server: ServerContext,
  dependencies: AutomationThreadTurnDependencies,
): Promise<{ messageId: string }> {
  const body = {
    conversationId: input.thread.conversationId,
    turnId: input.turnId,
    ...(input.modelId ? { modelId: input.modelId } : {}),
    messages: [{
      id: input.turnId,
      role: 'user',
      parts: [{ type: 'text', text: input.instructions }],
    }],
  }
  const request = new NextRequest(new URL('/api/v1/conversations/act', 'https://automation.internal'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': input.turnId },
    body: JSON.stringify(body),
  })
  const response = await (dependencies.executeChatTurn ?? executeActTurn)(request, {
    ...routeContext,
    parsedQuery: {},
    parsedJson: body,
    parsedFormData: null,
    requestFingerprint: input.turnId,
    requestIdempotencyKey: input.turnId,
  }, {
    automationRun: { automationId: input.automationId, runId: input.runId, owner: input.owner },
  })
  if (!response.ok) {
    const detail = await response.text().catch((_error) => '')
    throw new Error(`The chat turn did not start (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`)
  }
  const agentRunId = response.headers.get('x-overlay-agent-run-id')
  // The turn is durable; nobody reads this response's stream.
  await response.body?.cancel().catch((_error) => undefined)
  if (!agentRunId) throw new Error('The chat turn started without an agent run.')
  const agentRun = await server.appData.repositories.conversations.getLatestAgentRun({
    conversationId: asConversationId(input.thread.conversationId),
    userId: input.userId,
    agentRunId,
  })
  if (!agentRun || agentRun.id !== agentRunId || agentRun.turnId !== input.turnId) {
    throw new Error('The chat turn could not be read back.')
  }
  return { messageId: agentRun.userMessageId }
}
