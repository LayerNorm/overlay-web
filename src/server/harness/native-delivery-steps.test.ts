import { beforeEach, expect, test, vi } from 'vitest'
import { agentMemoryOwnerId } from '@/shared/agents/agent-memory'
import { finishNativeHarnessDelivery, attachNativeHarnessDelivery, projectNativeHarnessWait } from './native-delivery-steps'
import { buildNativeHarnessDelivery } from './native-tool-metrics'

const mocks = vi.hoisted(() => ({ get: vi.fn(), delivery: vi.fn(), attach: vi.fn(), complete: vi.fn(),
  finalize: vi.fn(), failMessage: vi.fn(), fail: vi.fn(), transition: vi.fn(), memory: vi.fn(), list: vi.fn(),
  listMessages: vi.fn(), agent: vi.fn(), sanitize: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.get; listPendingWaits = mocks.list } }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ appData: { repositories: {
  conversations: { getLatestAgentRun: mocks.delivery, transitionAgentRun: mocks.transition },
  conversationCollaboration: { finalizeAgentMessage: mocks.finalize, failAgentMessage: mocks.failMessage,
    enqueueMemoryExtraction: mocks.memory, listMessages: mocks.listMessages,
    sanitizeAgentMessageTextParts: mocks.sanitize },
} }, workspaceAgentService: { get: mocks.agent } }) }))
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
const assistantMessage = { _id: 'answer', turnId: 'turn', authorKind: 'agent', authorPrincipalId: 'agent-principal',
  status: 'generating', content: '' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockResolvedValue(state)
  mocks.delivery.mockResolvedValue(run)
  mocks.attach.mockResolvedValue(run)
  mocks.memory.mockResolvedValue(undefined)
  mocks.listMessages.mockResolvedValue([assistantMessage])
  mocks.agent.mockResolvedValue({ name: 'Agent' })
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

test('finalization replaces live tool progress without duplicate tool parts', async () => {
  const livePart = {
    type: 'tool-invocation',
    toolInvocation: { toolCallId: 'call', toolName: 'read_file', state: 'input-available', toolInput: { fileId: 'file' } },
  }
  const finalPart = {
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: 'call', toolName: 'read_file', state: 'output-available',
      toolInput: { fileId: 'file' }, toolOutput: { ok: true },
    },
  }
  let persistedParts: Array<Record<string, unknown>> = [livePart]
  mocks.finalize.mockImplementation(async (args: { parts?: Array<Record<string, unknown>> }) => {
    persistedParts = args.parts ?? persistedParts
  })
  await finishNativeHarnessDelivery(access, { ...delivery, parts: [finalPart] }, { memoryEnabled: false })
  expect(persistedParts).toEqual([finalPart])
  expect(persistedParts.filter(part => (
    part.type === 'tool-invocation'
    && (part.toolInvocation as { toolCallId?: string }).toolCallId === 'call'
  ))).toHaveLength(1)
})

test('native terminal persistence keeps the earlier answer when the last step is a textual tool call', async () => {
  const protocol = '<tool_call>harness_update_step<arg_key>id</arg_key><arg_value>step1</arg_value><arg_key>status</arg_key><arg_value>done</arg_value></tool_call>'
  const nativeDelivery = buildNativeHarnessDelivery({
    snapshot: {
      ...state, status: 'completed', resultSummary: protocol, workingSummary: protocol, evidence: [],
      usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    },
    messages: [],
    steps: [
      { text: 'The capital of France is Paris.', content: [{ type: 'text', text: 'The capital of France is Paris.' }], toolCalls: [], toolResults: [] },
      { text: protocol, content: [{ type: 'text', text: protocol }], toolCalls: [], toolResults: [] },
    ],
  } as never)
  expect(nativeDelivery.content).toBe('The capital of France is Paris.')
  expect(JSON.stringify(nativeDelivery.parts)).not.toContain('<tool_call>')
  await finishNativeHarnessDelivery(access, nativeDelivery, { memoryEnabled: false })
  expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
    content: 'The capital of France is Paris.',
    parts: [{ type: 'text', text: 'The capital of France is Paris.' }],
  }))
})

test('native terminal persistence strips nested JSON text parts and preserves tool progress and the answer', async () => {
  const protocol = '[[{"name":"get_note","parameters":{"noteId":"n1"}}]]'
  const toolProgress = {
    type: 'tool-invocation',
    toolInvocation: { toolCallId: 'call', toolName: 'get_note', state: 'output-available' },
  }
  const answer = { type: 'text', text: 'The note says 6.' }
  await finishNativeHarnessDelivery(access, {
    ...delivery,
    content: 'The note says 6.',
    parts: [{ type: 'text', text: protocol }, toolProgress, answer],
  }, { memoryEnabled: false }, new Set(['get_note']))
  expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
    content: 'The note says 6.',
    parts: [toolProgress, answer],
    toolNames: ['get_note'],
  }))
  expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ parts: [toolProgress, answer] }))
})

test('native failure keeps streamed partial content and cancellation is fenced', async () => {
  mocks.get.mockResolvedValue({ ...state, status: 'failed', terminalReason: 'Failed.' })
  mocks.listMessages.mockResolvedValue([{ ...assistantMessage, content: 'Partial streamed response' }])
  await finishNativeHarnessDelivery(access, delivery, { memoryEnabled: false })
  expect(mocks.failMessage).toHaveBeenCalledWith(expect.not.objectContaining({ content: expect.anything() }))
  expect(mocks.fail).toHaveBeenCalledOnce()
  mocks.get.mockResolvedValue({ ...state, status: 'cancelled' })
  await finishNativeHarnessDelivery(access, delivery, { memoryEnabled: false }, new Set(['get_note']))
  expect(mocks.sanitize).toHaveBeenCalledWith(expect.objectContaining({
    messageId: 'answer', toolNames: ['get_note'], turnId: 'turn',
  }))
  expect(mocks.transition).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', expectedWorkflowRunId: 'workflow' }))
})

test('native failure with empty content writes the friendly quota failure copy', async () => {
  mocks.get.mockResolvedValue({
    ...state, status: 'failed', terminalReason: 'free_tier_limit_exceeded: weekly agent limit reached',
  })
  await finishNativeHarnessDelivery(access, delivery, { memoryEnabled: false })
  expect(mocks.listMessages).toHaveBeenCalledWith({
    actorUserId: 'user', conversationId: 'room', messageId: 'answer', workspaceId: 'workspace', limit: 1,
  })
  expect(mocks.agent).toHaveBeenCalledWith({ actorUserId: 'user', workspaceId: 'workspace', agentId: 'agent' })
  expect(mocks.failMessage).toHaveBeenCalledWith(expect.objectContaining({
    content: 'Agent could not start this turn. Your message was saved; please try sending it again.',
  }))
  expect(mocks.failMessage.mock.calls[0][0].content).not.toContain('free_tier_limit_exceeded')
  expect(mocks.fail).toHaveBeenCalledOnce()
})

test('native failure with a foreign assistant row does not replace its content', async () => {
  mocks.get.mockResolvedValue({ ...state, status: 'failed', terminalReason: 'Failed.' })
  mocks.listMessages.mockResolvedValue([{ ...assistantMessage, authorPrincipalId: 'foreign-agent' }])
  await finishNativeHarnessDelivery(access, delivery, { memoryEnabled: false })
  expect(mocks.failMessage).toHaveBeenCalledWith(expect.not.objectContaining({ content: expect.anything() }))
  expect(mocks.agent).not.toHaveBeenCalled()
  expect(mocks.fail).toHaveBeenCalledOnce()
})

test('native failure still fails the run when reading the assistant message fails', async () => {
  mocks.get.mockResolvedValue({ ...state, status: 'failed', terminalReason: 'Failed.' })
  mocks.listMessages.mockRejectedValue(new Error('message store unavailable'))
  await expect(finishNativeHarnessDelivery(access, delivery, { memoryEnabled: false })).resolves.toBeUndefined()
  expect(mocks.failMessage).toHaveBeenCalledWith(expect.not.objectContaining({ content: expect.anything() }))
  expect(mocks.fail).toHaveBeenCalledOnce()
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
  expect(mocks.sanitize).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'answer' }))
  expect(mocks.finalize).not.toHaveBeenCalled()
  expect(mocks.fail).not.toHaveBeenCalled()
  expect(mocks.transition).not.toHaveBeenCalled()
})
