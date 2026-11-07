import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core/capabilities'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { ConversationListRow } from '@/server/conversations/ActConversationRepository'
import type { AgentRun } from '@/shared/agents/agent-run'
import { POST } from './route'

const conversation: ConversationListRow = {
  _id: 'conversation', userId: 'owner', workspaceId: 'workspace', title: 'Work',
  lastMode: 'act', lastModified: 1, createdAt: 1, updatedAt: 1, askModelIds: [], actModelId: 'model',
}
const run: AgentRun = {
  id: 'run', conversationId: 'conversation', turnId: 'turn', userId: 'owner',
  userMessageId: 'user-message', assistantMessageId: 'assistant-message', mode: 'work', runner: 'workflow',
  executionEngine: 'overlay_harness', harnessRunId: 'harness-run', workflowRunId: 'workflow',
  status: 'running', createdAt: 1, updatedAt: 1,
}
const receipt = {
  token: 'resource-token', runId: 'harness-run', rootRunId: 'harness-run', workflowRunId: 'workflow',
  grant: { kind: 'model_spend' as const, newMaxCostMicros: 2_000 },
  policyRevisionBefore: 0, policyRevisionAfter: 1, grantedAt: 2, maxCostMicros: 2_000, deadlineAt: 3,
}

function context(overrides: Partial<AppApiRouteContext['auth']> = {}): AppApiRouteContext {
  return {
    params: Promise.resolve({}), auth: { userId: 'owner', accessToken: 'test', authType: 'session', ...overrides },
    parsedQuery: {}, parsedJson: {}, parsedFormData: null, capabilities: DEFAULT_OVERLAY_CAPABILITIES,
    requestFingerprint: 'test', requestIdempotencyKey: null,
    workspace: {
      workspace: { id: 'workspace', kind: 'personal', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 },
      principal: { id: 'owner', userId: 'owner', workspaceId: 'workspace', type: 'human', displayName: 'QA', createdAt: 1, updatedAt: 1 },
      membership: { workspaceId: 'workspace', principalId: 'owner', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 },
    },
  }
}

function request() {
  return new NextRequest('https://example.test/api/v1/conversations/run/resources', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      conversationId: 'conversation', agentRunId: 'run', token: 'resource-token', policyRevision: 0,
      grant: { kind: 'model_spend', newMaxCostMicros: 2_000 },
    }),
  })
}

function dependencies(options: {
  conversation?: ConversationListRow | null
  run?: AgentRun | null
  grant?: () => Promise<typeof receipt>
  resume?: (token: string, payload: { token: string }) => Promise<unknown>
} = {}) {
  return {
    conversations: {
      getConversationById: async () => options.conversation === undefined ? conversation : options.conversation,
      getLatestAgentRun: async () => options.run === undefined ? run : options.run,
    },
    harness: { grantResources: options.grant ?? (async () => receipt) },
    resume: options.resume ?? (async () => ({ runId: 'workflow' })),
  }
}

test('an authenticated personal owner grants using exact delivery-derived Harness references', async () => {
  const calls: unknown[] = []
  const response = await POST(request(), context(), {
    ...dependencies({
      grant: async input => { calls.push(input); return receipt },
      resume: async (token, payload) => { calls.push({ token, payload }); return { runId: 'workflow' } },
    }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { receipt })
  assert.deepEqual(calls, [
    {
      actorUserId: 'owner', workspaceId: 'workspace', runId: 'harness-run', workflowRunId: 'workflow',
      token: 'resource-token', policyRevision: 0, grant: { kind: 'model_spend', newMaxCostMicros: 2_000 },
    },
    { token: 'resource-token', payload: { token: 'resource-token' } },
  ])
})

test('service and API-key callers fail before grant or wake', async () => {
  for (const authType of ['service', 'api-key'] as const) {
    let called = false
    const response = await POST(request(), context({ authType }), {
      ...dependencies({ grant: async () => { called = true; return receipt }, resume: async () => { called = true } }),
    })
    assert.equal(response.status, 404)
    assert.equal(called, false)
  }
})

test('wrong workspace or non-owner principal fails before grant or wake', async () => {
  for (const patch of [
    { workspace: { id: 'other', kind: 'personal', name: 'Other', slug: 'other', status: 'active', createdAt: 1, updatedAt: 1 } },
    { membership: { workspaceId: 'workspace', principalId: 'owner', role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 } },
    { membership: { workspaceId: 'workspace', principalId: 'other-principal', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 } },
    { principal: { id: 'owner', userId: 'other', workspaceId: 'workspace', type: 'human', displayName: 'Other', createdAt: 1, updatedAt: 1 } },
  ] as const) {
    const ownerContext = context()
    Object.assign(ownerContext.workspace, patch)
    let called = false
    const response = await POST(request(), ownerContext, {
      ...dependencies({ grant: async () => { called = true; return receipt }, resume: async () => { called = true } }),
    })
    assert.equal(response.status, 404)
    assert.equal(called, false)
  }
})

test('automation and surface conversations fail before grant or wake', async () => {
  for (const patch of [
    { isAutomation: true },
    { externalPlatform: 'slack', surfaceBindingId: 'surface' },
    { conversationType: 'channel' as const },
  ]) {
    let called = false
    const response = await POST(request(), context(), {
      ...dependencies({
        conversation: { ...conversation, ...patch },
        grant: async () => { called = true; return receipt },
        resume: async () => { called = true },
      }),
    })
    assert.equal(response.status, 404)
    assert.equal(called, false)
  }
})

test('an inactive delivery returns a definite changed-request conflict', async () => {
  let called = false
  const response = await POST(request(), context(), {
    ...dependencies({
      run: { ...run, status: 'completed' },
      grant: async () => { called = true; return receipt },
      resume: async () => { called = true; return { runId: 'workflow' } },
    }),
  })
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), {
    code: 'resource_request_changed',
    error: 'The resource request is no longer active.',
  })
  assert.equal(called, false)
})

test('an exact duplicate after consumption reaches backend idempotence and wake failure keeps receipt', async () => {
  let grantCalls = 0
  const response = await POST(request(), context(), {
    ...dependencies({
      grant: async () => { grantCalls++; return receipt },
      resume: async () => { throw new Error('hook unavailable') },
    }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { receipt })
  assert.equal(grantCalls, 1)
})

test('a missing wake acknowledgement keeps the committed receipt', async () => {
  const response = await POST(request(), context(), {
    ...dependencies({ resume: async () => undefined }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { receipt })
})

test('stale or incompatible grants return conflict and never wake', async () => {
  for (const error of [
    'HARNESS_RESOURCE_STALE',
    'HARNESS_RESOURCE_TOKEN_CONFLICT',
    'HARNESS_RESOURCE_GRANT_CONFLICT',
    'The model-spend grant must cover current commitments and the forecast.',
    'The grant scope must match the resource request reason.',
    'The model-spend grant must increase the cap without exceeding 100,000,000 micros.',
    'The time grant duration is unsupported.',
    'The resulting resource deadline is outside the safe range.',
  ]) {
    let woken = false
    const response = await POST(request(), context(), {
      ...dependencies({
        grant: async () => { throw new Error(error) },
        resume: async () => { woken = true; return { runId: 'workflow' } },
      }),
    })
    assert.equal(response.status, 409)
    assert.deepEqual(await response.json(), {
      code: 'resource_request_changed',
      error: 'The resource request changed; refresh the run and try again.',
    })
    assert.equal(woken, false)
  }
})

test('revoked backend authority is non-leaking and never wakes', async () => {
  for (const code of [
    'HARNESS_RESOURCE_NOT_AUTHORIZED', 'HARNESS_RESOURCE_AUTHORITY_CHANGED',
    'HARNESS_RESOURCE_MEMBERSHIP_DENIED', 'HARNESS_RESOURCE_WORKSPACE_DENIED',
    'HARNESS_RESOURCE_PAYER_DENIED', 'HARNESS_RESOURCE_SOURCE_DENIED',
    'HARNESS_RESOURCE_NOT_FOUND', 'WORKSPACE_ACCESS_DENIED', 'CONVERSATION_ACCESS_DENIED',
    'HARNESS_ACCESS_DENIED',
  ]) {
    let woken = false
    const response = await POST(request(), context(), {
      ...dependencies({
        grant: async () => { throw new Error(code) },
        resume: async () => { woken = true },
      }),
    })
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), {
      code: 'resource_not_authorized',
      error: 'This resource grant is not authorized.',
    })
    assert.equal(woken, false)
  }
})

test('ambiguous infrastructure failures remain unconfirmed and never wake', async () => {
  for (const error of [
    'transport lost after mutation dispatch',
    'invalid gateway response after mutation dispatch',
    'unsupported response encoding',
  ]) {
    let woken = false
    const response = await POST(request(), context(), {
      ...dependencies({
        grant: async () => { throw new Error(error) },
        resume: async () => { woken = true },
      }),
    })
    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), {
      code: 'resource_grant_unconfirmed',
      error: 'Could not confirm the resource grant. Refresh the run to check its authorization.',
    })
    assert.equal(woken, false)
  }
})
