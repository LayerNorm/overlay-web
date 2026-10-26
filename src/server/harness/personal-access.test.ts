import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import { refreshPersonalHarnessAccess, type PersonalHarnessAccess } from './personal-access'

const mocks = vi.hoisted(() => ({
  state: vi.fn(), keys: vi.fn(), workspace: vi.fn(), conversation: vi.fn(), agentRun: vi.fn(),
  subject: vi.fn(), capability: vi.fn(), model: vi.fn(), filter: vi.fn(), gate: vi.fn(), models: vi.fn(), byok: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.state } }))
vi.mock('@/server/conversations/http', () => ({ actEntitlementService: { gateModelAccess: mocks.gate } }))
vi.mock('@/server/ai/model-policy-authority', () => ({ resolveAuthorizedModelIds: mocks.models }))
vi.mock('@/server/ai/model-runtime', () => ({ assertUserCanUseByokModel: mocks.byok }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  appData: { repositories: { apiKeys: { listByUser: mocks.keys }, conversations: {
    getConversationById: mocks.conversation, getLatestAgentRun: mocks.agentRun,
  } } },
  workspaceService: { resolveActiveWorkspace: mocks.workspace },
  authorizationService: { resolveSubject: mocks.subject, checkResolvedCapability: mocks.capability,
    checkResolvedCatalogResourceAccess: mocks.model, filterCatalogResourceIds: mocks.filter },
}) }))

const access: PersonalHarnessAccess = { actorUserId: 'user', workspaceId: 'original-workspace', principalId: 'principal',
  runId: 'harness', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'agent-run', authentication: { type: 'session' } }
const context: PersonalChatWorkToolingContext = {
  userId: 'user', workspaceId: 'original-workspace', conversationId: 'conversation', effectiveModelId: 'provider/model',
  baseUrl: 'https://example.test', entitlements: { tier: 'free' } as never, paid: false, memoryEnabled: true,
  turnId: 'turn', requestFingerprint: 'fingerprint', requestedToolIds: ['files', 'web_search'],
  accountAllowedToolIds: ['files', 'web_search'], accountAllowedConnectorIds: ['gmail', 'slack'],
}
const snapshot = () => ({ ...createHarnessSnapshot({ runId: 'harness', goal: 'Read a document', constraints: [], policy: {
  actorUserId: 'user', workspaceId: 'original-workspace', allowedToolIds: ['read_file', 'call_mcp_tool'], requiresPlan: false,
  maxCostMicros: 1_000_000, deadlineAt: Date.now() + 60_000, maxDepth: 1, maxParallelChildren: 2,
} }, Date.now()), workflowRunId: 'workflow' })
const agentRun = () => ({ id: 'agent-run', conversationId: 'conversation', userId: 'user', workflowRunId: 'workflow',
  runner: 'workflow', mode: 'work', status: 'running' })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.state.mockResolvedValue(snapshot())
  mocks.workspace.mockResolvedValue({ workspace: { id: 'original-workspace' }, principal: { id: 'principal' } })
  mocks.conversation.mockResolvedValue({ userId: 'user', workspaceId: 'original-workspace', conversationType: 'personal' })
  mocks.agentRun.mockResolvedValue(agentRun())
  mocks.subject.mockResolvedValue({ userId: 'user' })
  mocks.capability.mockReturnValue({ allowed: true })
  mocks.model.mockResolvedValue({ allowed: true })
  mocks.filter.mockImplementation(async ({ resourceIds }) => resourceIds)
  mocks.gate.mockResolvedValue({ paid: true, runtimeEntitlements: { tier: 'paid' } })
  mocks.models.mockResolvedValue({ chat: new Set(['provider/model']) })
})

test('refreshes permissions and entitlements in the original workspace without expanding admission grants', async () => {
  mocks.filter.mockImplementation(async ({ resourceType }) => resourceType === 'tool' ? ['files', 'new-tool'] : ['slack', 'new-connector'])
  const refreshed = await refreshPersonalHarnessAccess(access, { ...context, accessToken: 'must-not-escape' } as typeof context, 'read_file')
  expect(mocks.workspace).toHaveBeenCalledWith('user', 'original-workspace')
  expect(mocks.gate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user', workspaceId: 'original-workspace' }))
  expect(refreshed).toMatchObject({ paid: true, entitlements: { tier: 'paid' }, accountAllowedToolIds: ['files'],
    accountAllowedConnectorIds: ['slack'], requestedToolIds: ['files'], approvalMode: 'ask', turnId: 'turn' })
  expect(refreshed).not.toHaveProperty('accessToken')
  mocks.capability.mockReturnValue({ allowed: false })
  await expect(refreshPersonalHarnessAccess(access, context, 'read_file')).rejects.toThrow(/revoked/)
  expect(mocks.subject).toHaveBeenCalledTimes(2)
})

test('rejects stale execution, cancelled delivery, changed principals and out-of-run tools', async () => {
  for (const state of [null, { ...snapshot(), workflowRunId: 'other' }, { ...snapshot(), status: 'cancelled' },
    { ...snapshot(), policy: { ...snapshot().policy, deadlineAt: 1 } }]) {
    mocks.state.mockResolvedValueOnce(state)
    await expect(refreshPersonalHarnessAccess(access, context)).rejects.toThrow(/not authorized/)
  }
  await expect(refreshPersonalHarnessAccess(access, context, 'ungranted')).rejects.toThrow(/capabilities/)
  mocks.agentRun.mockResolvedValueOnce({ ...agentRun(), status: 'cancelled' })
  await expect(refreshPersonalHarnessAccess(access, context)).rejects.toThrow(/resource access/)
  mocks.workspace.mockResolvedValueOnce({ workspace: { id: 'original-workspace' }, principal: { id: 'different' } })
  await expect(refreshPersonalHarnessAccess(access, context)).rejects.toThrow(/resource access/)
  mocks.conversation.mockResolvedValueOnce({ userId: 'user', workspaceId: 'other-workspace' })
  await expect(refreshPersonalHarnessAccess(access, context)).rejects.toThrow(/resource access/)
})

test('API key resumes check current revocation, expiration, owner and scopes without persisting the key', async () => {
  const apiAccess: PersonalHarnessAccess = { ...access, authentication: { type: 'api-key', apiKeyId: 'key' } }
  const key = { id: 'key', userId: 'user', scopes: ['chat:write'], expiresAt: Date.now() + 60_000 }
  mocks.keys.mockResolvedValue([key])
  await refreshPersonalHarnessAccess(apiAccess, context)
  for (const invalid of [null, { ...key, revokedAt: 1 }, { ...key, expiresAt: 1 }, { ...key, userId: 'other' }, { ...key, scopes: ['chat:read'] }]) {
    mocks.keys.mockResolvedValueOnce(invalid ? [invalid] : [])
    await expect(refreshPersonalHarnessAccess(apiAccess, context)).rejects.toThrow(/API key/)
  }
  expect(mocks.keys).toHaveBeenCalledWith({ userId: 'user' })
})

test('child execution keeps its own workflow fence but shares the root delivery run', async () => {
  const child = { ...snapshot(), runId: 'child', rootRunId: 'harness', parentRunId: 'harness', workflowRunId: 'child-workflow' }
  mocks.state.mockResolvedValueOnce(child).mockResolvedValueOnce({ ...snapshot(), status: 'waiting_for_children' })
  await refreshPersonalHarnessAccess({ ...access, runId: 'child', workflowRunId: 'child-workflow' }, context, 'read_file')
  expect(mocks.state).toHaveBeenNthCalledWith(2, { actorUserId: 'user', runId: 'harness' })
  mocks.state.mockResolvedValueOnce(child).mockResolvedValueOnce({ ...snapshot(), status: 'cancelled' })
  await expect(refreshPersonalHarnessAccess({ ...access, runId: 'child', workflowRunId: 'child-workflow' }, context, 'read_file')).rejects.toThrow(/root harness/)
})

test('checks current model policy and BYOK connection authority instead of trusting old entitlements', async () => {
  mocks.models.mockResolvedValueOnce({ chat: new Set() })
  await expect(refreshPersonalHarnessAccess(access, context)).rejects.toThrow(/model.*no longer/)
  await refreshPersonalHarnessAccess(access, { ...context, effectiveModelId: 'byok/connection/model' })
  expect(mocks.byok).toHaveBeenCalledWith('byok/connection/model', 'user')
  mocks.byok.mockRejectedValueOnce(new Error('BYOK connection not found'))
  await expect(refreshPersonalHarnessAccess(access, { ...context, effectiveModelId: 'byok/connection/model' })).rejects.toThrow(/not found/)
  mocks.capability.mockImplementation((_subject, capability) => ({ allowed: capability !== 'mcp.use' }))
  await expect(refreshPersonalHarnessAccess(access, context, 'call_mcp_tool')).rejects.toThrow(/revoked/)
})

test('cannot reuse the personal adapter for an automation, another identity or automatic approvals', async () => {
  for (const override of [{ userId: 'other' }, { automationExecution: true }, { approvalMode: 'auto' as const }]) {
    await expect(refreshPersonalHarnessAccess(access, { ...context, ...override })).rejects.toThrow(/identity/)
  }
  expect(mocks.state).not.toHaveBeenCalled()
})
