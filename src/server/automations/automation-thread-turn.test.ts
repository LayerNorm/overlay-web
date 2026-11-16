import assert from 'node:assert/strict'
import test from 'node:test'
import { startAutomationThreadTurn, type AutomationThreadTurnDependencies } from './automation-thread-turn'
import type { AutomationThreadTurnInput } from './AutomationService'

const workspace = { workspace: { id: 'workspace_1' }, principal: { id: 'principal_owner' } }

function input(kind: 'agent' | 'chat'): AutomationThreadTurnInput {
  return {
    automationId: 'automation_1',
    runId: 'run_1',
    owner: 'automation-thread:run_1',
    turnId: 'automation-run:run_1',
    userId: 'user_1',
    instructions: 'Summarize my inbox',
    modelId: 'model_1',
    scheduledFor: 1_700_000_000_000,
    thread: { conversationId: 'conversation_1', kind, workspaceId: 'workspace_1' },
    routeContext: {
      auth: { userId: 'user_1', authType: 'service' },
      workspace: { workspace: { id: 'workspace_default' }, principal: { id: 'principal_default' } },
      parsedJson: { runId: 'run_1' },
    } as never,
  }
}

function server(calls: Array<[string, unknown]>, overrides: { workspaceId?: string } = {}) {
  return () => ({
    workspaceService: {
      async resolveActiveWorkspace(userId: string, workspaceId: string) {
        calls.push(['workspace', { userId, workspaceId }])
        return { ...workspace, workspace: { id: overrides.workspaceId ?? workspaceId } }
      },
    },
    workspaceGovernanceService: {
      async assertWithinLimits(args: unknown) { calls.push(['limits', args]) },
    },
    appData: {
      repositories: {
        conversationCollaboration: {
          async addMessage(args: unknown) {
            calls.push(['message', args])
            return 'message_1'
          },
        },
        conversations: {
          async getLatestAgentRun(args: unknown) {
            calls.push(['agentRun', args])
            return { id: 'agent_run_1', turnId: 'automation-run:run_1', userMessageId: 'message_chat' }
          },
        },
      },
    },
  }) as never
}

test('an agent thread run posts the instructions as the owner and starts the agent like the composer does', async () => {
  const calls: Array<[string, unknown]> = []
  const dependencies: AutomationThreadTurnDependencies = {
    server: server(calls),
    async startAgentTurns(args) {
      calls.push(['agentTurns', args])
      return []
    },
    async executeChatTurn() { throw new Error('agent threads never use the chat entry point') },
  }

  assert.deepEqual(await startAutomationThreadTurn(input('agent'), dependencies), { messageId: 'message_1' })
  assert.deepEqual(calls, [
    ['workspace', { userId: 'user_1', workspaceId: 'workspace_1' }],
    ['limits', { action: 'message.send', scope: { workspaceId: 'workspace_1', principalId: 'principal_owner', conversationId: 'conversation_1' } }],
    ['message', {
      actorUserId: 'user_1', conversationId: 'conversation_1', workspaceId: 'workspace_1',
      turnId: 'automation-run:run_1', clientNonce: 'automation-run:run_1',
      content: 'Summarize my inbox', parts: [{ type: 'text', text: 'Summarize my inbox' }],
    }],
    ['agentTurns', {
      actorUserId: 'user_1', conversationId: 'conversation_1', initiatorPrincipalId: 'principal_owner',
      mentionedPrincipalIds: [], messageId: 'message_1', prompt: 'Summarize my inbox', memoryEnabled: true,
      turnId: 'automation-run:run_1', workspaceId: 'workspace_1', strictErrors: true,
    }],
  ])
})

test('a chat thread run calls the act entry point in its workspace under the automation authority', async () => {
  const calls: Array<[string, unknown]> = []
  let seen: { body: unknown; context: Record<string, unknown>; automationRun: unknown } | undefined
  const dependencies: AutomationThreadTurnDependencies = {
    server: server(calls),
    async startAgentTurns() { throw new Error('chats never start agent turns') },
    async executeChatTurn(request, context, deps) {
      seen = { body: await request.json(), context: context as never, automationRun: deps?.automationRun }
      return new Response('stream', { headers: { 'x-overlay-agent-run-id': 'agent_run_1' } })
    },
  }

  assert.deepEqual(await startAutomationThreadTurn(input('chat'), dependencies), { messageId: 'message_chat' })
  const body = {
    conversationId: 'conversation_1',
    turnId: 'automation-run:run_1',
    modelId: 'model_1',
    messages: [{ id: 'automation-run:run_1', role: 'user', parts: [{ type: 'text', text: 'Summarize my inbox' }] }],
  }
  assert.deepEqual(seen?.body, body)
  assert.deepEqual(seen?.context.parsedJson, body)
  assert.deepEqual((seen?.context.workspace as typeof workspace).workspace.id, 'workspace_1')
  assert.equal(seen?.context.requestIdempotencyKey, 'automation-run:run_1')
  assert.deepEqual(seen?.automationRun, { automationId: 'automation_1', runId: 'run_1', owner: 'automation-thread:run_1' })
  assert.deepEqual(calls.at(-1), ['agentRun', { conversationId: 'conversation_1', userId: 'user_1', agentRunId: 'agent_run_1' }])
})

test('a chat turn the act route refuses fails the run with its status', async () => {
  const dependencies: AutomationThreadTurnDependencies = {
    server: server([]),
    async executeChatTurn() {
      return Response.json({ error: 'harness_unavailable' }, { status: 503 })
    },
  }
  await assert.rejects(startAutomationThreadTurn(input('chat'), dependencies), /did not start \(503\)/)
})

test('an owner who lost the automation workspace gets no message', async () => {
  const calls: Array<[string, unknown]> = []
  await assert.rejects(
    startAutomationThreadTurn(input('agent'), { server: server(calls, { workspaceId: 'workspace_other' }) }),
    /no longer has access/,
  )
  assert.deepEqual(calls.map(([kind]) => kind), ['workspace'])
})
