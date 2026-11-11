import { gunzipSync } from 'node:zlib'
import { beforeEach, expect, test, vi } from 'vitest'
import { jsonToConvex } from 'convex/values'
import { buildAssistantVisualSequence } from '@overlay/chat-core'
import { buildGenerativeUiCatalogPrompt } from '@overlay/chat-core/generative-ui'
import type { HarnessTranscriptPersistence } from '@overlay/agent-runtime/harness-store'
import { publicHarnessStepPersistence, readSettledHarnessTranscript, writeSettledHarnessTranscriptStep } from './harness-transcript'
import { buildNativeHarnessDelivery } from './native-tool-metrics'
import { finishNativeHarnessDelivery } from './native-delivery-steps'

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), delivery: vi.fn(), finalize: vi.fn(), complete: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/database/lazy-convex', () => ({ lazyConvex: mocks }))
vi.mock('@/server/shared/internal-api-secret', () => ({ getInternalApiSecret: () => 'fixture-secret' }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ appData: { repositories: {
  conversations: { getLatestAgentRun: mocks.delivery },
  conversationCollaboration: { finalizeAgentMessage: mocks.finalize },
} } }) }))
vi.mock('@/server/conversations/http', () => ({ agentRunService: { complete: mocks.complete } }))

beforeEach(() => vi.resetAllMocks())

test('native journal and room finalization retain a failed bound form before its successful retry', async () => {
  const access = { actorUserId: 'user', runId: 'workspace:agent', workflowRunId: 'workflow', workspaceId: 'workspace',
    principalId: 'human', agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room',
    agentRunId: 'agent', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' }
  const snapshot = { runId: access.runId, workflowRunId: access.workflowRunId, status: 'completed',
    policy: { actorUserId: access.actorUserId, workspaceId: access.workspaceId, publicProgressVersion: 1 },
    evidence: [], usage: { inputTokens: 1, outputTokens: 1, costMicros: 0 } }
  mocks.delivery.mockResolvedValue({ id: access.agentRunId, userId: access.actorUserId, conversationId: access.conversationId,
    agentId: access.agentId, agentPrincipalId: access.agentPrincipalId, turnId: access.turnId,
    userMessageId: access.userMessageId, assistantMessageId: access.assistantMessageId,
    mode: 'room', runner: 'workflow', executionEngine: 'overlay_harness', harnessRunId: access.runId,
    workflowRunId: access.workflowRunId, status: 'running' })
  const journal: Array<{ receiptId: string; sequence: number; stepNumber: number; persistence: HarnessTranscriptPersistence }> = []
  const uploads: HarnessTranscriptPersistence[] = []
  const validateTransport = (args: unknown) => jsonToConvex(JSON.parse(JSON.stringify(args)))
  mocks.mutation.mockImplementation(async (path, args) => {
    validateTransport(args)
    if (path === 'harness/runs:beginTranscriptUpload') return 'https://storage.test/upload'
    if (path === 'harness/runs:writeTranscriptStep') {
      journal.push({ receiptId: args.receiptId, sequence: Number(args.receiptId.split(':')[1]),
        stepNumber: args.stepNumber, persistence: args.persistence })
      return { persisted: true }
    }
    return null
  })
  mocks.query.mockImplementation(async path => path === 'harness/runs:get'
    ? snapshot : { steps: [...journal].reverse(), cursor: '', isDone: true })
  vi.stubGlobal('fetch', vi.fn(async (_url, request) => {
    uploads.push(JSON.parse(gunzipSync(Buffer.from(request.body)).toString()))
    return new Response(JSON.stringify({ storageId: `full-${uploads.length}` }))
  }))
  mocks.finalize.mockImplementation(async args => { validateTransport(args) })
  mocks.complete.mockImplementation(async args => { validateTransport(args) })
  try {
    const example = buildGenerativeUiCatalogPrompt().split('\n').find(line => line.startsWith('Form example: '))!
    const spec = JSON.parse(example.slice('Form example: '.length))
    const rejectedSpec = structuredClone(spec)
    delete rejectedSpec.elements.card.props
    const generatedUi = { version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Feedback form', specJson: JSON.stringify(spec) }
    const step = (toolCallId: string, input: unknown, output: unknown) => {
      const call = { type: 'tool-call', toolCallId, toolName: 'render_ui', input }
      const result = { ...call, type: 'tool-result', output }
      return { stepNumber: 0, text: '', reasoning: [], content: [call, result], toolCalls: [call], toolResults: [result] }
    }
    const steps = [step('failed', { summary: 'Feedback form', spec: rejectedSpec },
      { success: false, code: 'tool_validation_failure', error: 'Could not display this view. No UI was created.',
        issues: [{ path: 'spec.elements/card/props', message: 'Required' }] }),
      step('retry', { summary: 'Feedback form', spec }, { success: true, id: 'view', generatedUi })]
    const activeTools = new Set(['render_ui'])
    for (const [sequence, modelStep] of steps.entries()) {
      await writeSettledHarnessTranscriptStep(access, `model:${sequence}`, 0, publicHarnessStepPersistence(modelStep as never, activeTools))
    }
    const settled = await readSettledHarnessTranscript(access)
    expect(settled.steps.map(item => item.sequence)).toEqual([0, 1])
    const fullFailure = uploads[0].parts[0].toolInvocation as Record<string, unknown>
    expect(fullFailure.toolInput).toEqual({ summary: 'Feedback form', spec: rejectedSpec })
    const cachedFailure = journal[0].persistence.parts[0].toolInvocation as Record<string, unknown>
    expect(JSON.parse(cachedFailure.toolInput as string)).toEqual(fullFailure.toolInput)
    const delivery = buildNativeHarnessDelivery({ outcome: 'finished', snapshot, messages: [], steps,
      stepReceiptIds: ['model:0', 'model:1'] } as never, activeTools, settled)
    await finishNativeHarnessDelivery(access, delivery, { memoryEnabled: false }, activeTools)
    const saved = mocks.finalize.mock.calls[0][0]
    const blocks = buildAssistantVisualSequence(saved.parts)
    expect(blocks.map(block => block.kind)).toEqual(['tool', 'generated-ui'])
    expect(blocks[0]).toMatchObject({ kind: 'tool', name: 'render_ui', state: 'output-error',
      toolOutput: { success: false, error: 'Could not display this view. No UI was created.' } })
    expect(blocks[1]).toMatchObject({ kind: 'generated-ui', part: { data: generatedUi } })
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ parts: saved.parts }))
  } finally {
    vi.unstubAllGlobals()
  }
})
