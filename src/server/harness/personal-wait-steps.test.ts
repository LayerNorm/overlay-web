import { beforeEach, expect, test, vi } from 'vitest'
import { notifyHarnessAncestors, projectPersonalHarnessWait, readHarnessChild } from './personal-wait-steps'

const mocks = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), delivery: vi.fn(), transition: vi.fn(), resume: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('workflow/api', () => ({ resumeHook: mocks.resume }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.get; listPendingWaits = mocks.list } }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ appData: { repositories: { conversations: {
  getLatestAgentRun: mocks.delivery, transitionAgentRun: mocks.transition,
} } } }) }))

const access = { actorUserId: 'user', runId: 'root', workflowRunId: 'workflow', conversationId: 'conversation',
  agentRunId: 'delivery', workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' as const } }
const root = { runId: 'root', rootRunId: 'root', workflowRunId: 'workflow', status: 'waiting_for_children', children: [{ id: 'child' }] }
const child = { runId: 'child', rootRunId: 'root', parentRunId: 'root', workflowRunId: 'child-workflow', status: 'waiting_for_input' }
const wait = { kind: 'input' as const, token: 'token', question: 'Which file?', runId: 'child', rootRunId: 'root',
  workflowRunId: 'child-workflow', createdAt: 100 }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockImplementation(async ({ runId }) => runId === 'root' ? root : runId === 'child' ? child : null)
  mocks.list.mockResolvedValue([wait])
  mocks.delivery.mockResolvedValue({ id: 'delivery', userId: 'user', conversationId: 'conversation', runner: 'workflow',
    mode: 'work', status: 'waiting_for_children', harnessRunId: 'root', workflowRunId: 'workflow' })
})

test('root projects stored child input with an atomic delivery workflow fence', async () => {
  expect(await projectPersonalHarnessWait(access, { wait: { ...wait, question: 'Not stored' } })).toBe('projected')
  const identity = { runId: 'delivery', userId: 'user', expectedWorkflowRunId: 'workflow' }
  expect(mocks.transition.mock.calls).toEqual([
    [{ ...identity, status: 'running' }],
    [{ ...identity, status: 'waiting_for_input', inputRequest: { token: 'token', question: 'Which file?', requestedAt: 100 } }],
  ])
})

test('stale requests do not mutate the delivery projection', async () => {
  mocks.list.mockResolvedValue([])
  expect(await projectPersonalHarnessWait(access, { wait })).toBe('stale')
  expect(mocks.transition).not.toHaveBeenCalled()
})

test('a child or stale workflow cannot control root delivery', async () => {
  await expect(projectPersonalHarnessWait({ ...access, runId: 'child', workflowRunId: 'child-workflow' }, { wait })).rejects.toThrow('owning root')
  await expect(projectPersonalHarnessWait({ ...access, workflowRunId: 'wrong' }, { wait })).rejects.toThrow('owning root')
  expect(mocks.transition).not.toHaveBeenCalled()
})

test('child reads are bounded to the exact admitted parent', async () => {
  expect(await readHarnessChild(access, 'child')).toEqual(child)
  await expect(readHarnessChild(access, 'sibling')).rejects.toThrow('Invalid child authority')
})

test('child notifications wake only authorized ancestors', async () => {
  await notifyHarnessAncestors({ actorUserId: 'user', runId: 'child', workflowRunId: 'child-workflow' })
  expect(mocks.resume).toHaveBeenCalledExactlyOnceWith('harness:wake:workflow', { childRunId: 'child' })
  await expect(notifyHarnessAncestors({ ...access, runId: 'child' })).rejects.toThrow('Invalid wake authority')
})
