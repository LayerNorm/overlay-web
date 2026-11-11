import { beforeEach, expect, test, vi } from 'vitest'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core/capabilities'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { AgentAskError } from '@/server/agents/agent-asks/AgentAskService'
import { POST } from './route'

vi.mock('server-only', () => ({}))
const asks = vi.hoisted(() => ({ list: vi.fn(), ask: vi.fn(), post: vi.fn(), read: vi.fn() }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ agentAsks: asks }) }))

const workspaceId = '11111111-2222-4333-8444-555555555555'
const userId = 'user_01M621SMKJ3A5PCARDE1X96R03'
const personalChief = `personal-chief-${workspaceId}-${userId}`
const workspacePersonalChief = `personal-chief-workspace-${workspaceId}-${userId}`
const context: AppApiRouteContext = {
  params: Promise.resolve({}), auth: { userId, accessToken: 'test', authType: 'session' },
  parsedQuery: {}, parsedJson: {}, parsedFormData: null, capabilities: DEFAULT_OVERLAY_CAPABILITIES,
  requestFingerprint: 'test', requestIdempotencyKey: null,
  workspace: {
    workspace: { id: workspaceId, kind: 'personal', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 },
    principal: { id: 'owner', userId, workspaceId, type: 'human', displayName: 'QA', createdAt: 1, updatedAt: 1 },
    membership: { workspaceId, principalId: 'owner', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 },
  },
}

const request = (parsedJson: Record<string, unknown>) => POST(new Request('https://example.test/api/v1/agent-asks', { method: 'POST' }), { ...context, parsedJson })

beforeEach(() => vi.resetAllMocks())

test.each([personalChief, workspacePersonalChief])('list accepts generated Chief identity %s and preserves authenticated scope', async callerAgentId => {
  expect(callerAgentId.length).toBeGreaterThan(80)
  asks.list.mockResolvedValue([{ id: 'specialist', name: 'Sales' }])
  const response = await request({ action: 'list', callerAgentId, userId: 'spoofed', workspaceId: 'other-workspace' })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ agents: [{ id: 'specialist', name: 'Sales' }] })
  expect(asks.list).toHaveBeenCalledExactlyOnceWith({ actorUserId: userId, workspaceId, callerAgentId })
})

test.each(['ordinary-agent', undefined])('list still accepts ordinary and outside callers: %s', async callerAgentId => {
  asks.list.mockResolvedValue([])
  expect((await request({ action: 'list', callerAgentId })).status).toBe(200)
})

test('ask forwards a long Chief identity and its turn to existing authorization', async () => {
  asks.ask.mockResolvedValue({ status: 'working' })
  const response = await request({ action: 'ask', callerAgentId: personalChief, callerConversationId: 'conversation', callerTurnId: 'turn', agent: 'specialist', message: 'Assess the pipeline.',
    nativeSurfaceTrigger: { userMessageId: 'forged' }, nativeAssignment: { parentRunId: 'forged', rootRunId: 'forged', toolCallId: 'forged' },
    sharedSurfaceContext: { surfaceExecution: { userMessageId: 'forged' } }, workspaceVisibleOnly: false })
  expect(response.status).toBe(200)
  expect(asks.ask).toHaveBeenCalledExactlyOnceWith({ actorUserId: userId, actorPrincipalId: 'owner', workspaceId,
    caller: { agentId: personalChief, conversationId: 'conversation', turnId: 'turn' },
    target: 'specialist', message: 'Assess the pipeline.', wait: true, assignmentId: undefined, expectedAttemptId: undefined })
})

test('post forwards long Chief identities but still requires the caller turn', async () => {
  asks.post.mockResolvedValue({ posted: true })
  const body = { action: 'post', callerAgentId: workspacePersonalChief, callerConversationId: 'parent', callerTurnId: 'turn', conversationId: 'child', text: 'Use the pilot scope.' }
  expect((await request(body)).status).toBe(200)
  expect(asks.post).toHaveBeenCalledExactlyOnceWith({ actorUserId: userId, actorPrincipalId: 'owner', workspaceId,
    caller: { agentId: workspacePersonalChief, conversationId: 'parent', turnId: 'turn' },
    conversationId: 'child', text: 'Use the pilot scope.', mentions: [] })
  expect((await request({ ...body, callerTurnId: undefined })).status).toBe(400)
  expect(asks.post).toHaveBeenCalledTimes(1)
})

test('accepting a generated ID does not bypass caller access checks', async () => {
  asks.ask.mockRejectedValue(new AgentAskError('Not allowed.', 403, 'forbidden'))
  const response = await request({ action: 'ask', callerAgentId: personalChief, callerConversationId: 'other-room', callerTurnId: 'turn', agent: 'specialist', message: 'Help.' })
  expect(response.status).toBe(403)
  expect(await response.json()).toEqual({ error: 'Not allowed.', code: 'forbidden' })
})

test('caller IDs remain bounded and malformed requests do not reach discovery', async () => {
  for (const callerAgentId of ['x'.repeat(201), 123]) {
    const response = await request({ action: 'list', callerAgentId })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'That request is not valid.', code: 'validation' })
  }
  expect(asks.list).not.toHaveBeenCalled()
})
