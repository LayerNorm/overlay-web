import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { NativeHarnessWorkflowInput } from './native-workflow-input'
import { nativeHarnessChildInput, nativeHarnessWorkflow, startNativeHarnessChild } from '@/server/workflows/native-harness'

const mocks = vi.hoisted(() => ({ read: vi.fn(), claim: vi.fn(), apply: vi.fn(), run: vi.fn(), ports: vi.fn(),
  tools: vi.fn(), waits: vi.fn(), attach: vi.fn(), finish: vi.fn(), notify: vi.fn(), child: vi.fn(),
  admit: vi.fn(), start: vi.fn(), conflict: vi.fn(), dispose: vi.fn(), fallback: vi.fn(), repositoryGet: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('workflow', () => ({
  FatalError: class extends Error {}, getWorkflowMetadata: () => ({ workflowRunId: 'workflow' }),
  createHook: () => ({ getConflict: mocks.conflict, [Symbol.dispose]: mocks.dispose,
    [Symbol.asyncIterator]: () => ({ next: async () => ({ value: {}, done: false }) }) }),
}))
vi.mock('workflow/api', () => ({ start: mocks.start }))
vi.mock('@/server/harness/ConvexHarnessRepository', () => ({
  ConvexHarnessRepository: class { get = mocks.repositoryGet },
}))
vi.mock('./state-steps', () => ({ readHarnessState: mocks.read, claimHarnessState: mocks.claim, applyHarnessOperation: mocks.apply }))
vi.mock('./runner', () => ({ runOverlayHarness: mocks.run }))
vi.mock('./native-ports', () => ({ createNativeHarnessExecutionPorts: mocks.ports }))
vi.mock('./native-tools', () => ({ createNativeHarnessTools: mocks.tools }))
vi.mock('./waits', () => ({ createHarnessWaitPorts: mocks.waits }))
vi.mock('./native-child-steps', () => ({ admitNativeHarnessChild: mocks.admit }))
vi.mock('./native-delivery-steps', () => ({ attachNativeHarnessDelivery: mocks.attach,
  finishNativeHarnessDelivery: mocks.finish, projectNativeHarnessWait: mocks.waits, writeNativeHarnessFallback: mocks.fallback }))
vi.mock('./personal-wait-steps', () => ({ harnessWakeToken: (id: string) => `harness:wake:${id}`,
  notifyHarnessAncestors: mocks.notify, readHarnessChild: mocks.child }))
vi.mock('@/server/harness/native-tools', () => ({ createNativeHarnessTools: mocks.tools }))

const input: NativeHarnessWorkflowInput = {
  access: { actorUserId: 'user', runId: 'workspace:agent', conversationId: 'room', workspaceId: 'workspace',
    principalId: 'human', agentId: 'agent', agentPrincipalId: 'agent-principal', agentRunId: 'agent',
    userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' },
  context: { modelId: 'fixture/model', memoryEnabled: true, sharedRoom: true, requestFingerprint: 'request' },
  definitions: [{ name: 'read', inputSchema: { type: 'object' }, needsApproval: false }],
  instructions: 'Be concise.', messages: [{ role: 'user', content: 'Read.' }],
}
let state: ReturnType<typeof createHarnessSnapshot>

beforeEach(() => {
  vi.resetAllMocks()
  state = { ...createHarnessSnapshot({ runId: 'workspace:agent', goal: 'Read', constraints: [], policy: {
    actorUserId: 'user', workspaceId: 'workspace', allowedToolIds: ['read'], requiresPlan: false,
    maxCostMicros: 100, deadlineAt: Date.now() + 60_000, maxDepth: 2, maxParallelChildren: 2,
  } }, Date.now()), workflowRunId: 'workflow' }
  mocks.read.mockResolvedValue(state)
  mocks.claim.mockResolvedValue(true)
  mocks.conflict.mockResolvedValue(null)
  mocks.tools.mockReturnValue({})
  mocks.ports.mockImplementation((_execution: unknown, surface: unknown) => ({ ...surface }))
  mocks.run.mockResolvedValue({ outcome: 'finished', snapshot: { ...state, status: 'completed' }, messages: [], steps: [] })
})

test('owner attaches and finalizes without supplying a writable stream', async () => {
  expect(await nativeHarnessWorkflow(input)).toEqual({ runId: 'workspace:agent', status: 'completed' })
  expect(mocks.attach).toHaveBeenCalledOnce()
  expect(mocks.finish).toHaveBeenCalledOnce()
  expect(mocks.run.mock.calls[0][0]).not.toHaveProperty('writable')
  expect(mocks.notify).not.toHaveBeenCalled()
})

test('a named delivery owner notifies its parent after finalization', async () => {
  state = { ...state, runId: 'workspace:target-run', rootRunId: 'workspace:agent', parentRunId: 'workspace:agent', depth: 1 }
  mocks.read.mockResolvedValue(state)
  mocks.run.mockResolvedValue({ outcome: 'finished', snapshot: { ...state, status: 'completed' }, messages: [], steps: [] })
  const childInput = {
    ...input,
    access: {
      ...input.access, runId: state.runId, agentRunId: 'target-run', agentId: 'target',
      agentPrincipalId: 'target-principal', conversationId: 'target-room', userMessageId: 'target-question',
      assistantMessageId: 'target-answer', turnId: 'target-turn',
    },
  }
  await expect(nativeHarnessWorkflow(childInput)).resolves.toEqual({ runId: state.runId, status: 'completed' })
  expect(mocks.attach).toHaveBeenCalledOnce()
  expect(mocks.finish).toHaveBeenCalledOnce()
  expect(mocks.notify).toHaveBeenCalledOnce()
})

test('anonymous child only notifies ancestors', async () => {
  state = { ...state, runId: 'child', parentRunId: 'workspace:agent' }
  mocks.read.mockResolvedValue(state)
  await nativeHarnessWorkflow({ ...input, access: { ...input.access, runId: 'child' } })
  expect(mocks.attach).not.toHaveBeenCalled()
  expect(mocks.finish).not.toHaveBeenCalled()
  expect(mocks.notify).toHaveBeenCalledOnce()
})

test('native child input preserves identity and bounds tools', () => {
  const child = { ...state, runId: 'child', goal: 'Read one', policy: { ...state.policy, allowedToolIds: ['read'] } }
  const bounded = nativeHarnessChildInput(input, child)
  expect(bounded.access.agentPrincipalId).toBe(input.access.agentPrincipalId)
  expect(bounded.access.runId).toBe('child')
  expect(bounded.definitions).toHaveLength(1)
  expect(JSON.stringify(bounded.messages)).not.toContain('Read.')
})

test('execution failure terminates and finalizes an owning native Harness run', async () => {
  const failed = { ...state, status: 'failed' as const, terminalReason: 'Harness execution failed.' }
  mocks.run.mockRejectedValue(new Error('Harness execution failed.'))
  mocks.apply.mockResolvedValue(failed)
  await expect(nativeHarnessWorkflow(input)).resolves.toEqual({ runId: state.runId, status: 'failed' })
  expect(mocks.apply).toHaveBeenCalledWith({ ...input.access, workflowRunId: 'workflow' }, 'execution-failed', {
    type: 'terminate', status: 'failed', reason: 'Harness execution failed.',
  })
  expect(mocks.finish).toHaveBeenCalledOnce()
})

test.each([
  ['mismatched native identity', true, true],
  ['unregistered child lineage', false, false],
])('child launcher rejects %s', async (_label, registered, mismatchIdentity) => {
  const parent = { ...input.access, workflowRunId: 'workflow' }
  const child = { ...state, runId: 'child', parentRunId: state.runId, rootRunId: state.runId,
    status: 'running' as const, goal: 'Read one', constraints: [], policy: { ...state.policy, allowedToolIds: ['read'] } }
  const parentState = { ...state, status: 'running' as const,
    children: registered ? [{ id: 'child' }] : [] }
  mocks.repositoryGet.mockImplementation(async ({ runId }: { runId: string }) =>
    runId === state.runId ? parentState : child)
  const childInput = nativeHarnessChildInput(input, child)
  if (mismatchIdentity) childInput.access.agentPrincipalId = 'foreign-principal'
  await expect(startNativeHarnessChild(parent, childInput)).rejects.toThrow('Invalid native child launch authority')
  expect(mocks.start).not.toHaveBeenCalled()
})
