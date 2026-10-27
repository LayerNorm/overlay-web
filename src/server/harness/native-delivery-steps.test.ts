import { beforeEach, expect, test, vi } from 'vitest'
import { agentMemoryOwnerId } from '@/shared/agents/agent-memory'
import { finishNativeHarnessDelivery, attachNativeHarnessDelivery, projectNativeHarnessWait } from './native-delivery-steps'

const mocks = vi.hoisted(() => ({ get: vi.fn(), delivery: vi.fn(), attach: vi.fn(), complete: vi.fn(),
  finalize: vi.fn(), failMessage: vi.fn(), fail: vi.fn(), transition: vi.fn(), memory: vi.fn(), list: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.get; listPendingWaits = mocks.list } }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ appData: { repositories: {
  conversations: { getLatestAgentRun: mocks.delivery, transitionAgentRun: mocks.transition },
  conversationCollaboration: { finalizeAgentMessage: mocks.finalize, failAgentMessage: mocks.failMessage, enqueueMemoryExtraction: mocks.memory },
} } }) }))
vi.mock('@/server/conversations/http', () => ({ agentRunService: { attachWorkflow: mocks.attach, complete: mocks.complete, fail: mocks.fail } }))

const access = { actorUserId: 'user', runId: 'workspace:agent', workflowRunId: 'workflow', workspaceId: 'workspace',
  principalId: 'human', agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room',
  agentRunId: 'agent', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' }
const state = { runId: access.runId, workflowRunId: 'workflow', policy: { actorUserId: 'user', workspaceId: 'workspace' }, status: 'completed' }
const run = { id: 'agent', userId: 'user', conversationId: 'room', agentId: 'agent', agentPrincipalId: 'agent-principal',
  turnId: 'turn', userMessageId: 'question', assistantMessageId: 'answer', mode: 'room', runner: 'workflow',
  executionEngine: 'overlay_harness', harnessRunId: 'workspace:agent', workflowRunId: 'workflow', status: 'running' }
const delivery = { content: 'Answer', parts: [{ type: 'reasoning', text: 'secret' }, { type: 'text', text: 'Answer' }],
  tokens: { input: 3, output: 2 }, routedModelId: 'fixture/model', metrics: { outputTokens: 2 } }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockResolvedValue(state)
  mocks.delivery.mockResolvedValue(run)
  mocks.attach.mockResolvedValue(run)
  mocks.memory.mockResolvedValue(undefined)
})

test('native owner attaches and finalizes an authoritative room message without reasoning', async () => {
  await attachNativeHarnessDelivery(access)
  await finishNativeHarnessDelivery(access, delivery, { memoryEnabled: true })
  expect(mocks.attach).toHaveBeenCalledOnce()
  expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
    messageId: 'answer', parts: [{ type: 'text', text: 'Answer' }],
  }))
  expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ runId: 'agent', parts: [{ type: 'text', text: 'Answer' }] }))
  expect(mocks.memory).toHaveBeenCalledWith(expect.objectContaining({
    memoryOwnerId: agentMemoryOwnerId('agent'), targetActor: 'agent', messageId: 'answer',
    turnId: 'turn', workspaceId: 'workspace',
  }))
})

test('native failure keeps streamed partial content and cancellation is fenced', async () => {
  mocks.get.mockResolvedValue({ ...state, status: 'failed', terminalReason: 'Failed.' })
  await finishNativeHarnessDelivery(access, delivery, { memoryEnabled: false })
  expect(mocks.failMessage).toHaveBeenCalledWith(expect.not.objectContaining({ content: expect.anything() }))
  expect(mocks.fail).toHaveBeenCalledOnce()
  mocks.get.mockResolvedValue({ ...state, status: 'cancelled' })
  await finishNativeHarnessDelivery(access, delivery, { memoryEnabled: false })
  expect(mocks.transition).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', expectedWorkflowRunId: 'workflow' }))
})

test('foreign room identity cannot project or finalize', async () => {
  mocks.delivery.mockResolvedValue({ ...run, agentPrincipalId: 'other' })
  await expect(projectNativeHarnessWait(access, { status: 'running' })).rejects.toThrow('ownership')
  await expect(finishNativeHarnessDelivery(access, delivery, { memoryEnabled: false })).rejects.toThrow('ownership')
})

test.each([
  ['anonymous child run id', () => mocks.get.mockResolvedValue({ ...state, runId: 'child' })],
  ['stale workflow', () => mocks.get.mockResolvedValue({ ...state, workflowRunId: 'stale' })],
  ['legacy execution engine', () => mocks.delivery.mockResolvedValue({ ...run, executionEngine: undefined })],
  ['foreign agent', () => mocks.delivery.mockResolvedValue({ ...run, agentId: 'other' })],
  ['foreign turn', () => mocks.delivery.mockResolvedValue({ ...run, turnId: 'other' })],
  ['foreign assistant message', () => mocks.delivery.mockResolvedValue({ ...run, assistantMessageId: 'other' })],
  ['non-room mode', () => mocks.delivery.mockResolvedValue({ ...run, mode: 'direct' })],
])('%s cannot attach native delivery', async (_label, configure) => {
  configure()
  await expect(attachNativeHarnessDelivery(access)).rejects.toThrow('ownership')
  expect(mocks.attach).not.toHaveBeenCalled()
})

test('attach permits an unattached AgentRun, then verifies its exact Workflow owner', async () => {
  mocks.delivery.mockResolvedValueOnce({ ...run, workflowRunId: undefined }).mockResolvedValueOnce(run)
  await expect(attachNativeHarnessDelivery(access)).resolves.toBeUndefined()
  expect(mocks.attach).toHaveBeenCalledOnce()
})

test('already-cancelled AgentRun is preserved without finalization', async () => {
  mocks.delivery.mockResolvedValue({ ...run, status: 'cancelled' })
  await finishNativeHarnessDelivery(access, delivery, { memoryEnabled: false })
  expect(mocks.finalize).not.toHaveBeenCalled()
  expect(mocks.fail).not.toHaveBeenCalled()
  expect(mocks.transition).not.toHaveBeenCalled()
})
