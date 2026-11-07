import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), work: vi.fn(), acknowledge: vi.fn(), settle: vi.fn(), prepare: vi.fn(),
  dispatch: vi.fn(), start: vi.fn(), cancel: vi.fn(), cancelSubtree: vi.fn(), finish: vi.fn(), transcript: vi.fn(), delivery: vi.fn(), notify: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class {
  get = mocks.get; getNativeRecoveryWork = mocks.work; acknowledgeNativeRecovery = mocks.acknowledge; settleAssignmentResult = mocks.settle
} }))
vi.mock('./native-workflow-input-builder', () => ({ buildNativeHarnessWorkflowInput: mocks.prepare }))
vi.mock('./native-tool-steps', () => ({ dispatchNativeHarnessAgentRequest: mocks.dispatch }))
vi.mock('./native-turn-start', () => ({ startNativeHarnessTurn: mocks.start }))
vi.mock('./workflow-cancellation', () => ({ cancelHarnessWorkflow: mocks.cancel }))
vi.mock('./personal-cancellation', () => ({ cancelPersonalHarnessWorkflows: mocks.cancelSubtree }))
vi.mock('./native-delivery-steps', () => ({ finishNativeHarnessDelivery: mocks.finish }))
vi.mock('./harness-transcript', () => ({ readHarnessTranscriptForDelivery: mocks.transcript }))
vi.mock('./native-tool-metrics', () => ({ buildNativeHarnessDelivery: mocks.delivery }))
vi.mock('./personal-wait-steps', () => ({ notifyHarnessAncestors: mocks.notify }))

import { executeNativeRecoveryWork, readNativeRecoveryWork, acknowledgeNativeRecoveryWork } from './native-recovery-steps'

const identity = { actorUserId: 'requester', workspaceId: 'workspace', conversationId: 'chief-room', deliveryRunId: 'chief-delivery' }
const root = { runId: 'workspace:chief-delivery', rootRunId: 'workspace:chief-delivery', workflowRunId: 'chief-workflow', executionGeneration: 0, status: 'running' }
const assignment = { ...identity, kind: 'assignment' as const, parentRunId: root.runId, rootRunId: root.runId,
  workflowRunId: root.workflowRunId, executionGeneration: 0, toolCallId: 'original-dispatch', agentId: 'specialist', brief: 'Original bounded task' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockResolvedValue(root)
  mocks.prepare.mockResolvedValue({ access: { actorUserId: 'requester', runId: root.runId }, context: { memoryEnabled: false }, definitions: [{ name: 'read_file' }] })
})

test('recovery replays the persisted dispatch identity after fresh native preparation, not a new ask', async () => {
  await executeNativeRecoveryWork(assignment)
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: identity.actorUserId, workspaceId: identity.workspaceId,
    conversationId: identity.conversationId, runId: identity.deliveryRunId, surfaceRootRunId: root.runId, expectedSurfaceWorkflowRunId: root.workflowRunId }))
  expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: identity.actorUserId, workflowRunId: root.workflowRunId }),
    { memoryEnabled: false }, 'original-dispatch', 'ask_agent', { agent: 'specialist', message: 'Original bounded task', assignmentId: undefined, expectedAttemptId: undefined, wait: false })
  expect(mocks.start).not.toHaveBeenCalled()
})

test('stale owners and generations cannot resume work or launch a workflow', async () => {
  mocks.get.mockResolvedValue({ ...root, executionGeneration: 1 })
  await executeNativeRecoveryWork(assignment)
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.dispatch).not.toHaveBeenCalled()
  expect(mocks.start).not.toHaveBeenCalled()
})

test('queued recovery retains the original requester and memory setting', async () => {
  await executeNativeRecoveryWork({ ...identity, kind: 'turn', memoryEnabled: true })
  expect(mocks.start).toHaveBeenCalledWith({ actorUserId: identity.actorUserId, workspaceId: identity.workspaceId,
    conversationId: identity.conversationId, runId: identity.deliveryRunId, memoryEnabled: true })
  expect(mocks.dispatch).not.toHaveBeenCalled()
})

test('publication repair uses the persisted transcript and does not restart model or tool work', async () => {
  const child = { ...root, runId: 'workspace:child', parentRunId: root.runId, workflowRunId: 'child-workflow', status: 'completed' }
  mocks.get.mockImplementation(async ({ runId }) => runId === child.runId ? child : root)
  const transcript = { persistence: { content: 'The complete final answer' }, steps: [] }
  mocks.transcript.mockResolvedValue(transcript)
  mocks.delivery.mockReturnValue({ content: 'The complete final answer' })
  await executeNativeRecoveryWork({ ...identity, kind: 'publication', runId: child.runId, workflowRunId: child.workflowRunId, executionGeneration: 0 })
  expect(mocks.delivery).toHaveBeenCalledWith(expect.objectContaining({ snapshot: child }), new Set(['read_file']), transcript)
  expect(mocks.finish).toHaveBeenCalledOnce()
  expect(mocks.settle).toHaveBeenCalledWith(child.runId)
  expect(mocks.dispatch).not.toHaveBeenCalled()
  expect(mocks.start).not.toHaveBeenCalled()
})

test('empty/stale recovery is a no-op and acknowledgements retain the fenced request', async () => {
  const request = { kind: 'assignment' as const, id: 'intent', generation: 4 }
  mocks.work.mockResolvedValue(null)
  expect(await readNativeRecoveryWork(request)).toBeNull()
  await acknowledgeNativeRecoveryWork(request)
  expect(mocks.acknowledge).toHaveBeenCalledWith(request)
  expect(mocks.dispatch).not.toHaveBeenCalled()
})

test('failed fresh authorization cannot launch or publish anything', async () => {
  mocks.prepare.mockRejectedValue(new Error('Authorization revoked'))
  await expect(executeNativeRecoveryWork(assignment)).rejects.toThrow('Authorization revoked')
  expect(mocks.dispatch).not.toHaveBeenCalled()
  expect(mocks.finish).not.toHaveBeenCalled()
})
