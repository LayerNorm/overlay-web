import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core/capabilities'
import { CONVEX_APP_DATA_CAPABILITIES } from '@/server/app-data/capabilities'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { ConversationListRow } from '@/server/conversations/ActConversationRepository'
import type { AgentRun } from '@/shared/agents/agent-run'
import { POST } from './route'

const conversation: ConversationListRow = {
  _id: 'room-a', userId: 'owner', title: 'Private room', lastMode: 'act',
  lastModified: 1, createdAt: 1, updatedAt: 1, askModelIds: [], actModelId: 'model',
  workspaceId: 'workspace-a', conversationType: 'dm',
}
const run: AgentRun = {
  id: 'run-a', conversationId: 'room-a', turnId: 'turn-a', userId: 'owner',
  userMessageId: 'message-user', assistantMessageId: 'message-agent',
  mode: 'room', runner: 'workflow', status: 'waiting_for_approval',
  approval: { token: 'token-a', requestedAt: 1, requests: [] }, createdAt: 1, updatedAt: 1,
}
function context(userId: string): AppApiRouteContext {
  return {
    params: Promise.resolve({}), auth: { userId, accessToken: 'test', authType: 'session' },
    parsedQuery: {}, parsedJson: {}, parsedFormData: null,
    capabilities: DEFAULT_OVERLAY_CAPABILITIES, appDataCapabilities: CONVEX_APP_DATA_CAPABILITIES,
    requestFingerprint: 'test', requestIdempotencyKey: null,
    workspace: {
      workspace: { id: 'workspace-a', kind: 'personal', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 },
      principal: { id: userId, userId, workspaceId: 'workspace-a', type: 'human', displayName: 'QA', createdAt: 1, updatedAt: 1 },
      membership: { workspaceId: 'workspace-a', principalId: userId, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 },
    },
  }
}
function request(approved = true, token = 'token-a') {
  return new NextRequest('https://example.test/api/v1/conversations/run/approval', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: 'room-a', agentRunId: 'run-a', token, approved }),
  })
}

test('outsiders cannot approve or deny a private room, even with its valid hook token', async () => {
  for (const approved of [true, false]) {
    const response = await POST(request(approved), context('outsider'), {
      conversations: {
        getConversationById: async () => null,
        getLatestAgentRun: async () => { throw new Error('CONVERSATION_ACCESS_DENIED') },
      },
      collaboration: { getAccessibleConversation: async (args) => {
        assert.deepEqual(args, { actorUserId: 'outsider', conversationId: 'room-a', workspaceId: 'workspace-a' })
        return null
      } },
      resume: async () => assert.fail('An inaccessible room must not resume the workflow'),
    })
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Not found' })
  }
})

test('another participant cannot decide the initiating user approval', async () => {
  const response = await POST(request(), context('participant'), {
    conversations: { getConversationById: async () => null, getLatestAgentRun: async () => run },
    collaboration: { getAccessibleConversation: async () => conversation },
    resume: async () => assert.fail('Only the initiator may resume the workflow'),
  })
  assert.equal(response.status, 403)
})

test('a shared personal conversation does not let another participant approve the owner tools', async () => {
  const response = await POST(request(), context('participant'), {
    conversations: { getConversationById: async () => null, getLatestAgentRun: async () => ({ ...run, mode: 'work' }) },
    collaboration: { getAccessibleConversation: async () => conversation },
    resume: async () => assert.fail('Personal approvals must remain owner-only'),
  })
  assert.equal(response.status, 403)
})

test('the initiator can decide an active approval, including legacy personal conversations', async () => {
  for (const approved of [true, false]) {
    const decisions: unknown[] = []
    const response = await POST(request(approved), context('owner'), {
      conversations: { getConversationById: async () => conversation, getLatestAgentRun: async () => run },
      collaboration: { getAccessibleConversation: async () => assert.fail('Owner lookup already granted access') },
      resume: async (token, decision) => { decisions.push({ token, decision }) },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(decisions, [{ token: 'token-a', decision: { approved } }])
  }
})

test('an accessible conversation does not make a stale token valid', async () => {
  const response = await POST(request(true, 'stale'), context('owner'), {
    conversations: { getConversationById: async () => conversation, getLatestAgentRun: async () => run },
    collaboration: { getAccessibleConversation: async () => conversation },
    resume: async () => assert.fail('Stale tokens must not resume the workflow'),
  })
  assert.equal(response.status, 409)
})
