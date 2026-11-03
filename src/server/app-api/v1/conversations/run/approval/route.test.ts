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
  executionEngine: 'overlay_harness',
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

test('legacy approvals return retirement instead of waking an old workflow', async () => {
  for (const mode of ['room', 'chat', 'work'] as const) {
    const response = await POST(request(), context('owner'), {
      conversations: {
        getConversationById: async () => conversation,
        getLatestAgentRun: async () => ({ ...run, mode, executionEngine: undefined }),
      },
      collaboration: { getAccessibleConversation: async () => conversation },
      resume: async () => assert.fail('Retired workflows must not resume'),
    })
    assert.equal(response.status, 410)
    assert.deepEqual(await response.json(), {
      code: 'native_runner_retired', error: 'The harness has changed. Start a new thread to continue.',
    })
  }
})

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
    const personal = { ...conversation, conversationType: undefined }
    const decisions: unknown[] = []
    const response = await POST(request(approved), context('owner'), {
      conversations: { getConversationById: async () => personal, getLatestAgentRun: async () => ({ ...run, mode: 'work' }) },
      collaboration: { getAccessibleConversation: async () => assert.fail('Owner lookup already granted access') },
      resume: async (token, decision) => { decisions.push({ token, decision }) },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(decisions, [{ token: 'token-a', decision: { approved } }])
  }
})

test('V2 approval persists without requiring a live workflow hook', async () => {
  let submitted: unknown
  const response = await POST(request(), context('owner'), {
    conversations: { getConversationById: async () => conversation,
      getLatestAgentRun: async () => ({ ...run, harnessRunId: 'harness-run' }) },
    collaboration: { getAccessibleConversation: async () => conversation },
    submitWaitReply: async value => { submitted = value; return true },
    resume: async () => assert.fail('V2 approval must not depend on a live hook'),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(submitted, { actorUserId: 'owner', workspaceId: 'workspace-a', deliveryAgentRunId: 'run-a',
    token: 'token-a', reply: { approved: true } })
})

test('a missed durable legacy approval reply falls back to the workflow hook', async () => {
  let resumed: unknown
  const response = await POST(request(false), context('owner'), {
    conversations: { getConversationById: async () => conversation,
      getLatestAgentRun: async () => ({ ...run, harnessRunId: 'legacy-harness' }) },
    collaboration: { getAccessibleConversation: async () => conversation },
    submitWaitReply: async () => false,
    resume: async (token, decision) => { resumed = { token, decision } },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(resumed, { token: 'token-a', decision: { approved: false } })
})

test('room creators with revoked membership cannot decide a pending approval', async () => {
  for (const approved of [true, false]) {
    const response = await POST(request(approved), context('owner'), {
      conversations: {
        getConversationById: async () => conversation,
        getLatestAgentRun: async () => assert.fail('Revoked participation must be checked before reading the run'),
      },
      collaboration: { getAccessibleConversation: async args => {
        assert.deepEqual(args, { actorUserId: 'owner', conversationId: 'room-a', workspaceId: 'workspace-a' })
        return null
      } },
      resume: async () => assert.fail('Revoked participation must not resume the workflow'),
    })
    assert.equal(response.status, 404)
  }
})

test('an owned personal conversation in another workspace cannot be approved', async () => {
  const response = await POST(request(), context('owner'), {
    conversations: {
      getConversationById: async args => {
        assert.equal(args.workspaceId, 'workspace-a')
        return { ...conversation, conversationType: 'personal', workspaceId: 'workspace-b' }
      },
      getLatestAgentRun: async () => assert.fail('Workspace access must be checked before reading the run'),
    },
    collaboration: { getAccessibleConversation: async () => assert.fail('Personal owner lookup does not use room access') },
    resume: async () => assert.fail('Another workspace must not resume the workflow'),
  })
  assert.equal(response.status, 404)
})

test('a room creator with current participation can decide a pending approval', async () => {
  let membershipChecked = false
  let resumed = false
  const response = await POST(request(), context('owner'), {
    conversations: { getConversationById: async () => conversation, getLatestAgentRun: async () => run },
    collaboration: { getAccessibleConversation: async () => { membershipChecked = true; return conversation } },
    resume: async () => { resumed = true },
  })
  assert.equal(response.status, 200)
  assert.equal(membershipChecked, true)
  assert.equal(resumed, true)
})

test('the initiator can approve an active native Harness room run in a Slack channel', async () => {
  const channel = {
    ...conversation,
    userId: 'room-creator',
    conversationType: 'channel' as const,
    externalPlatform: 'slack' as const,
    externalChannelId: 'channel',
    externalThreadId: 'thread',
    surfaceBindingId: 'binding',
  }
  const nativeRun = { ...run, executionEngine: 'overlay_harness' as const }
  let resumed = false
  const response = await POST(request(), context('owner'), {
    conversations: {
      getConversationById: async () => null,
      getLatestAgentRun: async () => nativeRun,
    },
    collaboration: { getAccessibleConversation: async () => channel },
    resume: async () => { resumed = true },
  })
  assert.equal(response.status, 200)
  assert.equal(resumed, true)
})

test('an accessible conversation does not make a stale token valid', async () => {
  const response = await POST(request(true, 'stale'), context('owner'), {
    conversations: { getConversationById: async () => conversation, getLatestAgentRun: async () => run },
    collaboration: { getAccessibleConversation: async () => conversation },
    resume: async () => assert.fail('Stale tokens must not resume the workflow'),
  })
  assert.equal(response.status, 409)
})
