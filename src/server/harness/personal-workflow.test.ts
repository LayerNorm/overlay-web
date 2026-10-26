import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionPorts } from './ports'
import type { PersonalHarnessWorkflowInput } from './personal-workflow-input'
import { personalHarnessChildInput, personalHarnessWorkflow } from '@/server/workflows/personal-harness'

const mocks = vi.hoisted(() => ({ read: vi.fn(), claim: vi.fn(), apply: vi.fn(), run: vi.fn(), ports: vi.fn(),
  tools: vi.fn(), waits: vi.fn(), attach: vi.fn(), finish: vi.fn(), close: vi.fn(), notify: vi.fn(),
  child: vi.fn(), admit: vi.fn(), start: vi.fn(), get: vi.fn(), progress: vi.fn(), conflict: vi.fn(), dispose: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('workflow', () => ({
  FatalError: class extends Error {}, getWorkflowMetadata: () => ({ workflowRunId: 'workflow' }),
  getWritable: () => undefined,
  createHook: () => ({ getConflict: mocks.conflict, [Symbol.dispose]: mocks.dispose,
    [Symbol.asyncIterator]: () => ({ next: async () => ({ value: {}, done: false }) }) }),
}))
vi.mock('workflow/api', () => ({ start: mocks.start }))
vi.mock('./state-steps', () => ({ readHarnessState: mocks.read, claimHarnessState: mocks.claim, applyHarnessOperation: mocks.apply }))
vi.mock('./runner', () => ({ runOverlayHarness: mocks.run }))
vi.mock('./personal-ports', () => ({ createPersonalHarnessExecutionPorts: mocks.ports }))
vi.mock('./personal-tools', () => ({ createPersonalHarnessTools: mocks.tools }))
vi.mock('./personal-waits', () => ({ createPersonalHarnessWaitPorts: mocks.waits }))
vi.mock('./personal-child-steps', () => ({ admitPersonalHarnessChild: mocks.admit }))
vi.mock('./personal-delivery-steps', () => ({ attachPersonalHarnessDelivery: mocks.attach,
  finishPersonalHarnessDelivery: mocks.finish, closePersonalHarnessStream: mocks.close }))
vi.mock('./personal-wait-steps', () => ({ harnessWakeToken: (id: string) => `harness:wake:${id}`,
  notifyHarnessAncestors: mocks.notify, readHarnessChild: mocks.child }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.get } }))
vi.mock('@/server/conversations/personal-chat-work-lifecycle', () => ({ persistPersonalChatWorkProgress: mocks.progress }))

const input: PersonalHarnessWorkflowInput = {
  access: { actorUserId: 'user', runId: 'root', conversationId: 'conversation', agentRunId: 'delivery',
    workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' } },
  context: { userId: 'user', workspaceId: 'workspace', conversationId: 'conversation', effectiveModelId: 'fixture/model',
    baseUrl: 'https://example.test', memoryEnabled: false, requestedToolIds: ['read', 'write'], turnId: 'turn', requestFingerprint: 'request' },
  definitions: ['read', 'write'].map(name => ({ name, inputSchema: { type: 'object' }, needsApproval: false })),
  instructions: 'Never publish without approval.', messages: [{ role: 'user', content: 'Unrelated private parent history.' }],
  delivery: { emitWebhook: true },
}
let state: HarnessSnapshot
const completed = () => ({ outcome: 'finished', snapshot: { ...state, status: 'completed', resultSummary: 'Verified result.' }, messages: [], steps: [] })

beforeEach(() => {
  vi.resetAllMocks()
  state = { ...createHarnessSnapshot({ runId: 'root', goal: 'Check the records', constraints: [], policy: {
    actorUserId: 'user', workspaceId: 'workspace', allowedToolIds: ['read', 'write'], requiresPlan: false,
    maxCostMicros: 100, deadlineAt: Date.now() + 60_000, maxDepth: 2, maxParallelChildren: 2,
  } }, Date.now()), workflowRunId: 'workflow' }
  mocks.read.mockImplementation(async () => state)
  mocks.claim.mockResolvedValue(true)
  mocks.conflict.mockResolvedValue(null)
  mocks.ports.mockImplementation((_execution, surface) => ({ ...surface, recordModelStep: vi.fn() }))
  mocks.run.mockImplementation(async () => completed())
})

test('root registers wakeups before executing and persists authoritative delivery before closing', async () => {
  expect(await personalHarnessWorkflow(input)).toEqual({ runId: 'root', status: 'completed' })
  expect(mocks.conflict.mock.invocationCallOrder[0]).toBeLessThan(mocks.run.mock.invocationCallOrder[0])
  expect(mocks.attach.mock.invocationCallOrder[0]).toBeLessThan(mocks.run.mock.invocationCallOrder[0])
  expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ workflowRunId: 'workflow' }),
    expect.objectContaining({ content: 'Verified result.' }), { emitWebhook: true, turnId: 'turn' })
  expect(mocks.finish.mock.invocationCallOrder[0]).toBeLessThan(mocks.close.mock.invocationCallOrder[0])
  expect(mocks.notify).not.toHaveBeenCalled()
  expect(mocks.dispose).toHaveBeenCalledOnce()
})

test('a duplicate workflow cannot build tools, bill or finalize another execution', async () => {
  mocks.claim.mockResolvedValue(false)
  expect(await personalHarnessWorkflow(input)).toEqual({ runId: 'root', status: 'already_running' })
  expect(mocks.ports).not.toHaveBeenCalled()
  expect(mocks.tools).not.toHaveBeenCalled()
  expect(mocks.finish).not.toHaveBeenCalled()
  expect(mocks.run).not.toHaveBeenCalled()
})

test('a completed child notifies ancestors without writing the root transcript', async () => {
  state.parentRunId = 'parent'
  await personalHarnessWorkflow(input)
  expect(mocks.attach).not.toHaveBeenCalled()
  expect(mocks.finish).not.toHaveBeenCalled()
  expect(mocks.notify).toHaveBeenCalledExactlyOnceWith({ ...input.access, workflowRunId: 'workflow' })
})

test('child execution receives a focused brief and tool subset while retaining system guardrails', () => {
  const child = { ...state, runId: 'child', parentRunId: 'root', goal: 'Read one source', constraints: ['Do not edit'],
    policy: { ...state.policy, allowedToolIds: ['read'] } }
  const bounded = personalHarnessChildInput(input, child)
  expect(bounded.definitions.map(tool => tool.name)).toEqual(['read'])
  expect(bounded.instructions).toContain('Never publish without approval.')
  expect(bounded.context.latestUserText).toBe(child.goal)
  expect(JSON.stringify(bounded.messages)).not.toContain('Unrelated private parent history')
  expect(bounded.delivery).toBeUndefined()
})

test('retrying child launch reuses claimed child ownership instead of starting again', async () => {
  const child = { ...state, runId: 'child', parentRunId: 'root', workflowRunId: 'child-workflow' }
  state.children = [{ id: 'child', stepId: 'read', status: 'running', maxCostMicros: 0, costMicros: 0, allowedToolIds: ['read'], evidenceRefs: [] }]
  mocks.child.mockResolvedValue(child)
  mocks.admit.mockResolvedValue(state.children[0])
  mocks.get.mockImplementation(async ({ runId }) => runId === 'root' ? state : child)
  mocks.run.mockImplementation(async (_execution, ports: HarnessExecutionPorts) => {
    await ports.delegate({ stepId: 'read', goal: 'Read one source', constraints: [], allowedToolIds: ['read'], maxCostMicros: 0 }, 'delegate-call')
    return completed()
  })
  await personalHarnessWorkflow(input)
  expect(mocks.admit).toHaveBeenCalledOnce()
  expect(mocks.start).not.toHaveBeenCalled()
})

test('execution failure is persisted before a child wakes its parent', async () => {
  state.parentRunId = 'parent'
  mocks.run.mockRejectedValue(new Error('Access was revoked.'))
  mocks.apply.mockResolvedValue({ ...state, status: 'failed', terminalReason: 'Access was revoked.' })
  expect(await personalHarnessWorkflow(input)).toEqual({ runId: 'root', status: 'failed' })
  expect(mocks.apply).toHaveBeenCalledWith(expect.anything(), 'execution-failed', { type: 'terminate', status: 'failed', reason: 'Access was revoked.' })
  expect(mocks.apply.mock.invocationCallOrder[0]).toBeLessThan(mocks.notify.mock.invocationCallOrder[0])
})
