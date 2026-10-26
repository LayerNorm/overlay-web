import { beforeEach, expect, test, vi } from 'vitest'
import { admitPersonalHarnessChild } from './personal-child-steps'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), get: vi.fn(), apply: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./personal-access', () => ({ refreshPersonalHarnessAccess: mocks.refresh }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.get; apply = mocks.apply } }))
const input = {
  access: { actorUserId: 'user', runId: 'root', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery',
    workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' as const } },
  context: { userId: 'user', workspaceId: 'workspace', conversationId: 'conversation', effectiveModelId: 'fixture/model',
    baseUrl: 'https://example.test', memoryEnabled: false, requestedToolIds: [], turnId: 'turn', requestFingerprint: 'request' },
}
const delegation = { stepId: 'read', goal: 'Read the source', constraints: ['Do not write'], allowedToolIds: ['read'], maxCostMicros: 0 }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockResolvedValue({ runId: 'root', workflowRunId: 'workflow', revision: 1 })
  mocks.apply.mockImplementation(async ({ operation }) => ({ conflict: false, snapshot: { children: [operation.child] } }))
})

test('delegation retries use one deterministic admission and stable child budget reservation', async () => {
  mocks.apply.mockResolvedValueOnce({ conflict: true })
  const first = await admitPersonalHarnessChild(input, delegation, 'call')
  const replay = await admitPersonalHarnessChild(input, delegation, 'call')
  expect(first).toEqual(replay)
  expect(new Set(mocks.apply.mock.calls.map(([args]) => args.operationId)).size).toBe(1)
  expect(mocks.apply).toHaveBeenLastCalledWith(expect.objectContaining({
    actorUserId: 'user', runId: 'root', operation: { type: 'admit_child', child: first, goal: delegation.goal, constraints: delegation.constraints },
  }))
  expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.apply.mock.invocationCallOrder[0])
})

test('revoked personal access and a stale workflow cannot admit children', async () => {
  mocks.refresh.mockRejectedValueOnce(new Error('Revoked'))
  await expect(admitPersonalHarnessChild(input, delegation, 'call')).rejects.toThrow('Revoked')
  mocks.get.mockResolvedValue({ runId: 'root', workflowRunId: 'other', revision: 1 })
  await expect(admitPersonalHarnessChild(input, delegation, 'call')).rejects.toThrow('delegation authority')
  expect(mocks.apply).not.toHaveBeenCalled()
})
