import { beforeEach, expect, test, vi } from 'vitest'
import { admitNativeHarnessChild } from './native-child-steps'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), get: vi.fn(), apply: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./native-access', () => ({ refreshNativeHarnessAccess: mocks.refresh }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.get; apply = mocks.apply } }))

const input = {
  access: { actorUserId: 'user', runId: 'workspace:agent', workflowRunId: 'workflow', workspaceId: 'workspace',
    principalId: 'human', agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room',
    agentRunId: 'agent', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' },
  context: { modelId: 'fixture/model', memoryEnabled: false, sharedRoom: true, requestFingerprint: 'request' },
}
const delegation = { stepId: 'read', goal: 'Read the source', constraints: [], allowedToolIds: ['read'], maxCostMicros: 10 }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockResolvedValue({ runId: input.access.runId, workflowRunId: 'workflow', revision: 1,
    policy: { actorUserId: 'user', workspaceId: 'workspace' } })
  mocks.apply.mockImplementation(async ({ operation }: { operation: { child: unknown } }) => ({
    conflict: false, snapshot: { children: [operation.child] },
  }))
})

test('native admission refreshes authority and deterministically reserves an unfinished child', async () => {
  const first = await admitNativeHarnessChild(input, delegation, 'call')
  const replay = await admitNativeHarnessChild(input, delegation, 'call')
  expect(first).toEqual(replay)
  expect(mocks.refresh).toHaveBeenCalledTimes(2)
  expect(new Set(mocks.apply.mock.calls.map(([args]) => args.operationId)).size).toBe(1)
  expect(mocks.apply.mock.calls[0][0].operation.child.status).toBe('running')
})

test('stale native workflow cannot admit a child', async () => {
  mocks.get.mockResolvedValue({ runId: input.access.runId, workflowRunId: 'other', revision: 1,
    policy: { actorUserId: 'user', workspaceId: 'workspace' } })
  await expect(admitNativeHarnessChild(input, delegation, 'call')).rejects.toThrow('delegation authority')
  expect(mocks.apply).not.toHaveBeenCalled()
})
