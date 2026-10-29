import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core/capabilities'
import { CONVEX_APP_DATA_CAPABILITIES } from '@/server/app-data/capabilities'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { ConversationListRow } from '@/server/conversations/ActConversationRepository'
import type { AgentRun } from '@/shared/agents/agent-run'
import { POST } from './route'

const conversation: ConversationListRow = { _id: 'conversation', userId: 'owner', workspaceId: 'workspace', title: 'Work',
  lastMode: 'act', lastModified: 1, createdAt: 1, updatedAt: 1, askModelIds: [], actModelId: 'model' }
const run: AgentRun = { id: 'run', conversationId: 'conversation', turnId: 'turn', userId: 'owner',
  userMessageId: 'user-message', assistantMessageId: 'assistant-message', mode: 'work', runner: 'workflow',
  workflowRunId: 'workflow', status: 'waiting_for_input', inputRequest: { token: 'token', requestedAt: 1, question: 'Which file?' },
  createdAt: 1, updatedAt: 1 }
const context: AppApiRouteContext = {
  params: Promise.resolve({}), auth: { userId: 'owner', accessToken: 'test', authType: 'session' },
  parsedQuery: {}, parsedJson: {}, parsedFormData: null, capabilities: DEFAULT_OVERLAY_CAPABILITIES,
  appDataCapabilities: CONVEX_APP_DATA_CAPABILITIES, requestFingerprint: 'test', requestIdempotencyKey: null,
  workspace: {
    workspace: { id: 'workspace', kind: 'personal', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 },
    principal: { id: 'owner', userId: 'owner', workspaceId: 'workspace', type: 'human', displayName: 'QA', createdAt: 1, updatedAt: 1 },
    membership: { workspaceId: 'workspace', principalId: 'owner', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 },
  },
}
function request(extra: Record<string, unknown> = {}) {
  return new NextRequest('https://example.test/api/v1/conversations/run/input', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: 'conversation', agentRunId: 'run',
      token: 'token', text: 'The quarterly report.', ...extra }) })
}

test('the owner can submit bounded text to the exact waiting run', async () => {
  const replies: unknown[] = []
  const response = await POST(request(), context, { conversations: {
    getConversationById: async args => {
      assert.deepEqual(args, { conversationId: 'conversation', userId: 'owner', workspaceId: 'workspace' })
      return conversation
    }, getLatestAgentRun: async () => run,
  }, resume: async (token, reply) => { replies.push({ token, reply }) } })
  assert.equal(response.status, 200)
  assert.deepEqual(replies, [{ token: 'token', reply: { text: 'The quarterly report.' } }])
})

test('missing access and a different workspace cannot resume a hook even with its token', async () => {
  for (const resource of [null, { ...conversation, userId: 'someone-else' }, { ...conversation, workspaceId: 'other' }]) {
    const response = await POST(request(), context, { conversations: {
      getConversationById: async () => resource, getLatestAgentRun: async () => assert.fail('Must authorize the conversation first'),
    }, resume: async () => assert.fail('No unauthorized wake') })
    assert.equal(response.status, 404)
  }
})

test('stale, foreign and non-personal runs cannot receive personal input', async () => {
  for (const patch of [
    { status: 'running' as const }, { status: 'cancelled' as const }, { inputRequest: { ...run.inputRequest!, token: 'old' } },
    { userId: 'other' }, { id: 'other-run' }, { conversationId: 'other-conversation' }, { mode: 'room' as const },
    { runner: 'remote' as const }, { workflowRunId: undefined },
  ]) {
    const response = await POST(request(), context, { conversations: {
      getConversationById: async () => conversation, getLatestAgentRun: async () => ({ ...run, ...patch }),
    }, resume: async () => assert.fail('No inactive wake') })
    assert.equal(response.status, 409)
  }
})

test('arbitrary message roles and empty or oversized text are rejected at the boundary', async () => {
  for (const extra of [{ role: 'system' }, { text: '  ' }, { text: 'x'.repeat(32_001) }]) {
    const response = await POST(request(extra), context, { conversations: {
      getConversationById: async () => assert.fail('Invalid input must not reach data access'), getLatestAgentRun: async () => null,
    }, resume: async () => assert.fail('Invalid input must not resume') })
    assert.equal(response.status, 400)
  }
})

test('only the initiating user with current room access can resume a native Harness input wait', async () => {
  const room = { ...conversation, userId: 'room-creator', conversationType: 'dm' as const }
  const nativeRun = { ...run, mode: 'room' as const, executionEngine: 'overlay_harness' as const }
  for (const scenario of ['allowed', 'revoked', 'other-initiator', 'legacy', 'other-workspace']) {
    let resumed = false
    const response = await POST(request(), context, {
      conversations: {
        getConversationById: async () => room,
        getLatestAgentRun: async () => ({
          ...nativeRun,
          ...(scenario === 'other-initiator' ? { userId: 'other-user' } : {}),
          ...(scenario === 'legacy' ? { executionEngine: undefined } : {}),
        }),
      },
      collaboration: {
        getAccessibleConversation: async args => {
          assert.deepEqual(args, { actorUserId: 'owner', conversationId: 'conversation', workspaceId: 'workspace' })
          return scenario === 'revoked' ? null : { ...room, ...(scenario === 'other-workspace' ? { workspaceId: 'other' } : {}) }
        },
      },
      resume: async () => { resumed = true },
    })
    assert.equal(response.status, scenario === 'allowed' ? 200 : ['revoked', 'other-workspace'].includes(scenario) ? 404 : 409)
    assert.equal(resumed, scenario === 'allowed')
  }
})
