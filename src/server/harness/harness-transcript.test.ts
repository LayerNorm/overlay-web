import { expect, test, vi } from 'vitest'
import type { HarnessExecutionResult } from './runner'
vi.mock('server-only', () => ({}))
vi.mock('./state-steps', () => ({ readHarnessState: vi.fn(), applyHarnessOperation: vi.fn() }))
import { publicHarnessStepPersistence, readSettledHarnessTranscript, readHarnessTranscriptForDelivery } from './harness-transcript'
import { buildPersonalHarnessDelivery } from './personal-delivery'
import { buildNativeHarnessDelivery } from './native-tool-metrics'
import { buildGenerativeUiCatalogPrompt } from '@overlay/chat-core/generative-ui'
import { buildAssistantVisualSequence } from '@overlay/chat-core'

test.each(['render_ui', 'present_generated_ui'])('failed %s followed by a successful retry survives personal and native delivery', toolName => {
  const example = buildGenerativeUiCatalogPrompt().split('\n').find(line => line.startsWith('Form example: '))!
  const generatedUi = toolName === 'render_ui'
    ? { version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Bug report', specJson: example.slice('Form example: '.length) }
    : { version: 1, kind: 'questionnaire', prompt: 'Which QA environment?', multiple: false,
        choices: [{ id: 'preview', label: 'Preview' }, { id: 'production', label: 'Production' }] }
  const toolStep = (toolCallId: string, output: unknown) => {
    const call = { type: 'tool-call', toolCallId, toolName, input: {} }
    const result = { type: 'tool-result', toolCallId, toolName, output }
    return { stepNumber: 0, text: '', reasoning: [], content: [call, result], toolCalls: [call], toolResults: [result] }
  }
  const steps = [toolStep('failed', { success: false, error: 'Invalid spec', issues: [{ path: 'children' }] }),
    { stepNumber: 0, text: 'Fixing the spec.', content: [{ type: 'text', text: 'Fixing the spec.' }], reasoning: [], toolCalls: [], toolResults: [] },
    toolStep('retry', { success: true, id: 'view', generatedUi }),
    { stepNumber: 0, text: 'The view is ready.', content: [{ type: 'text', text: 'The view is ready.' }], reasoning: [], toolCalls: [], toolResults: [] }]
  const activeTools = new Set([toolName])
  const journalSteps = steps.map((step, sequence) => ({ receiptId: `model:${sequence}`, sequence, stepNumber: 0,
    persistence: publicHarnessStepPersistence(step as never, activeTools) }))
  const settled = { steps: journalSteps, persistence: { content: 'Fixing the spec.\n\nThe view is ready.',
    parts: journalSteps.flatMap(step => step.persistence.parts) } }
  const result = { snapshot: { runId: 'run', status: 'completed', evidence: [], usage: { inputTokens: 1, outputTokens: 1, costMicros: 0 } },
    steps, messages: [], outcome: 'finished', stepReceiptIds: steps.map((_, i) => `model:${i}`) } as unknown as HarnessExecutionResult
  for (const transcript of [undefined, settled]) {
    for (const delivery of [buildPersonalHarnessDelivery(result, undefined, activeTools, transcript), buildNativeHarnessDelivery(result, activeTools, transcript)]) {
      const blocks = buildAssistantVisualSequence(delivery.parts)
      expect(blocks.map(block => block.kind)).toEqual(['tool', 'text', 'generated-ui', 'text'])
      expect(blocks[0]).toMatchObject({ kind: 'tool', state: 'output-error' })
      expect(blocks[2]).toMatchObject({ kind: 'generated-ui', part: { data: generatedUi } })
    }
  }
})

test('settled public persistence excludes private reasoning and keeps sanitized tool display', () => {
  const persistence = publicHarnessStepPersistence({
    stepNumber: 0,
    text: 'The result is ready.',
    reasoningText: 'private chain of thought',
    reasoning: [{ type: 'reasoning', text: 'private part' }],
    content: [
      { type: 'reasoning', text: 'private part' },
      { type: 'text', text: 'The result is ready.' },
      { type: 'tool-result', toolCallId: 'call-1', toolName: 'get_note', input: { noteId: 'n1' },
        output: { success: true, display: { title: 'Public note' }, overlayModelOutput: { private: true } } },
    ],
    toolCalls: [],
    toolResults: [
      { type: 'tool-result', toolCallId: 'call-1', toolName: 'get_note', input: { noteId: 'n1' },
        output: { success: true, display: { title: 'Public note' }, overlayModelOutput: { private: true } } },
    ],
  } as never, new Set(['get_note']))

  expect(persistence.content).toContain('The result is ready.')
  expect(JSON.stringify(persistence)).toContain('Public note')
  expect(JSON.stringify(persistence)).not.toContain('private chain of thought')
  expect(JSON.stringify(persistence)).not.toContain('private part')
  expect(JSON.stringify(persistence)).not.toContain('overlayModelOutput')
})

test('public journal keeps every part and full tool payload independently of the compact chat snapshot', () => {
  const output = { body: 'public result '.repeat(1_000), nested: Array.from({ length: 30 }).reduce(value => ({ child: value }), 'deep leaf' as unknown) }
  const content = Array.from({ length: 96 }, (_, index) => index % 2 === 0
    ? { type: 'text', text: `Update ${index}.` }
    : { type: 'tool-result', toolCallId: `call-${index}`, toolName: 'get_note', input: { noteId: `n${index}` }, output })
  const persistence = publicHarnessStepPersistence({
    stepNumber: 0, text: '', reasoning: [], content, toolCalls: [], toolResults: [],
  } as never, new Set(['get_note']))
  expect(persistence.parts).toHaveLength(96)
  expect(persistence.parts[0]).toEqual({ type: 'text', text: 'Update 0.' })
  expect(JSON.stringify(persistence.parts[1])).toContain(output.body)
  expect(JSON.stringify(persistence.parts[1])).toContain('deep leaf')
  expect(JSON.stringify(persistence)).not.toContain('storageOmittedParts')
  expect(JSON.stringify(persistence)).not.toContain('"truncated":true')
})

test('full public persistence retains long tool errors but excludes control approvals and reasoning', () => {
  const error = 'Public tool failure.'.repeat(1_000)
  const persistence = publicHarnessStepPersistence({
    stepNumber: 0, text: '', reasoning: [], toolCalls: [], toolResults: [], content: [
      { type: 'reasoning', text: 'private thought' },
      { type: 'tool-approval-request', approvalId: 'private-approval', toolCall: {
        toolCallId: 'private-call', toolName: 'harness_update_step', input: { private: true },
      } },
      { type: 'tool-error', toolCallId: 'public-call', toolName: 'get_note', input: {}, error },
    ],
  } as never, new Set(['get_note']))
  expect(JSON.stringify(persistence)).toContain(error)
  expect(JSON.stringify(persistence)).not.toContain('private')
})

test('failure delivery restores journal order, deduplicates matching settled steps, and keeps new live text', () => {
  const result = {
    outcome: 'finished',
    snapshot: {
      runId: 'root',
      status: 'failed',
      evidence: [],
      usage: { inputTokens: 2, outputTokens: 3, costMicros: 0 },
    },
    messages: [],
    steps: [
      { stepNumber: 0, text: 'First settled step.', content: [{ type: 'text', text: 'First settled step.' }], toolCalls: [], toolResults: [] },
      { stepNumber: 0, text: 'Second settled step.', content: [{ type: 'text', text: 'Second settled step.' }], toolCalls: [], toolResults: [] },
      { stepNumber: 0, text: 'Unsettled live text.', content: [{ type: 'text', text: 'Unsettled live text.' }], toolCalls: [], toolResults: [] },
    ],
    stepReceiptIds: ['model:0', 'model:1', 'model:2'],
  } as unknown as HarnessExecutionResult
  const settledTranscript = {
    persistence: {
      content: 'First settled step.\n\nSecond settled step.',
      parts: [
        { type: 'text', text: 'First settled step.' },
        { type: 'text', text: 'Second settled step.' },
      ],
    },
    steps: [
      { receiptId: 'model:0', sequence: 0, stepNumber: 0, persistence: { content: 'First settled step.', parts: [{ type: 'text', text: 'First settled step.' }] } },
      { receiptId: 'model:1', sequence: 1, stepNumber: 0, persistence: { content: 'Second settled step.', parts: [{ type: 'text', text: 'Second settled step.' }] } },
    ],
  }

  const delivery = buildPersonalHarnessDelivery(result, undefined, new Set(), settledTranscript)
  expect(delivery.content).toBe('First settled step.\n\nSecond settled step.\n\nUnsettled live text.')
  expect(delivery.content.match(/First settled step\./g)).toHaveLength(1)
  expect(delivery.content.match(/Second settled step\./g)).toHaveLength(1)
})

test('a caught failure with lost local steps still reconstructs the settled transcript', () => {
  const result = {
    outcome: 'finished',
    snapshot: {
      runId: 'root',
      status: 'failed',
      evidence: [],
      usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    },
    messages: [],
    steps: [],
  } as unknown as HarnessExecutionResult
  const delivery = buildPersonalHarnessDelivery(result, undefined, new Set(), {
    persistence: { content: 'Saved before the interruption.', parts: [{ type: 'text', text: 'Saved before the interruption.' }] },
    steps: [{ receiptId: 'model:3', sequence: 3, stepNumber: 0,
      persistence: { content: 'Saved before the interruption.', parts: [{ type: 'text', text: 'Saved before the interruption.' }] } }],
  })

  expect(delivery.content).toBe('Saved before the interruption.')
})

test('final result summary survives an empty or compacted journal window', () => {
  const result = {
    outcome: 'finished',
    snapshot: {
      runId: 'root', status: 'completed', resultSummary: 'The final result is preserved.',
      evidence: [], usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    },
    messages: [],
    steps: [],
  } as unknown as HarnessExecutionResult
  const delivery = buildPersonalHarnessDelivery(result, undefined, new Set(), {
    persistence: { content: '', parts: [] }, steps: [], newestSequence: null,
  })
  expect(delivery.content).toContain('The final result is preserved.')
  expect(delivery.parts.at(-1)).toEqual({
    type: 'text', text: 'The final result is preserved.', id: JSON.stringify(['root', 'final', 1]),
  })
})

test('final result summary survives a full newest transcript content and part window', () => {
  const summary = 'The final answer is newer than the full journal window.'
  const result = {
    outcome: 'finished',
    snapshot: {
      runId: 'root', status: 'completed', resultSummary: summary,
      evidence: [], usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    },
    messages: [],
    steps: [],
  } as unknown as HarnessExecutionResult
  const delivery = buildPersonalHarnessDelivery(result, undefined, new Set(), {
    persistence: {
      content: 'x'.repeat(160_000),
      parts: Array.from({ length: 80 }, (_, index) => ({ type: 'text', text: `journal part ${index}` })),
    },
    steps: [],
    newestSequence: 79,
  })
  expect(delivery.content).toContain(summary)
  expect(delivery.parts).toHaveLength(81)
  expect(delivery.parts.at(-1)).toEqual({
    type: 'text', text: summary, id: JSON.stringify(['root', 'final', 80]),
  })
})

test('settled transcript reads keep the newest 500 steps and preserve final answer', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({
    receiptId: `model:${500 - index}`,
    sequence: 500 - index,
    stepNumber: 0,
    persistence: { content: index === 0 ? 'Final answer retained.' : `step ${500 - index}`, parts: [] },
  }))
  const pageReader = vi.fn(async (_reference: unknown, cursor: string | null) => {
    const pageIndex = cursor == null ? 0 : Number(cursor) + 1
    const steps = rows.slice(pageIndex * 25, pageIndex * 25 + 25)
    return { steps, cursor: String(pageIndex), isDone: pageIndex === 20 }
  })
  const window = await readSettledHarnessTranscript({
    actorUserId: 'user', runId: 'run', workflowRunId: 'workflow',
  }, pageReader as never)
  expect(window.truncated).toBe(true)
  expect(window.steps).toHaveLength(500)
  expect(window.newestSequence).toBe(500)
  expect(window.persistence.content).toContain('Final answer retained.')
  const result = {
    outcome: 'finished',
    snapshot: { runId: 'run', status: 'failed', evidence: [], usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 } },
    messages: [],
    steps: [
      { stepNumber: 0, text: 'old live', content: [{ type: 'text', text: 'old live' }], toolCalls: [], toolResults: [] },
      { stepNumber: 0, text: 'new live', content: [{ type: 'text', text: 'new live' }], toolCalls: [], toolResults: [] },
    ],
    stepReceiptIds: ['model:1', 'model:501'],
  } as unknown as HarnessExecutionResult
  const delivery = buildPersonalHarnessDelivery(result, undefined, new Set(), window)
  expect(delivery.content).not.toContain('old live')
  expect(delivery.content).toContain('new live')
})

test('non-advancing or malformed journal pagination remains a persistence failure', async () => {
  const reference = { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' }
  const stuck = async () => ({ steps: [], cursor: null, isDone: false })
  const malformed = async () => ({ steps: null, cursor: null, isDone: false })
  const malformedStep = async () => ({
    steps: [{ receiptId: 'model:0', sequence: 0, stepNumber: 0, persistence: null }],
    cursor: null, isDone: true,
  })
  await expect(readSettledHarnessTranscript(reference, stuck as never)).rejects.toThrow('Harness persistence failed.')
  await expect(readSettledHarnessTranscript(reference, malformed as never)).rejects.toThrow('Harness persistence failed.')
  await expect(readSettledHarnessTranscript(reference, malformedStep as never)).rejects.toThrow('Harness persistence failed.')
})


test('public bookkeeping is hidden without discarding real work tools', () => {
  const control = { type: 'tool-result', toolName: 'harness_update_step', toolCallId: 'control', input: {}, output: { success: true } }
  const work = { type: 'tool-result', toolName: 'get_note', toolCallId: 'work', input: {}, output: { title: 'Verified note' } }
  const step = { stepNumber: 0, text: '', reasoning: [], content: [control, work],
    toolCalls: [control, work].map(part => ({ ...part, type: 'tool-call' })), toolResults: [control, work] }
  const journal = publicHarnessStepPersistence(step as never, new Set(['get_note']))
  expect(JSON.stringify(journal)).not.toContain('harness_update_step')
  expect(JSON.stringify(journal)).toContain('get_note')
  const result = { snapshot: { status: 'completed', usage: { inputTokens: 1, outputTokens: 1, costMicros: 1 } },
    steps: [step], messages: [], outcome: 'finished' } as unknown as HarnessExecutionResult
  const delivery = buildPersonalHarnessDelivery(result)
  expect(JSON.stringify(delivery)).not.toContain('harness_update_step')
  expect(JSON.stringify(delivery)).toContain('get_note')
})


test('journal read outage finalizes with a reconciliation diagnostic without repeating work', async () => {
  const { readHarnessState, applyHarnessOperation } = await import('./state-steps')
  const state = { runId: 'root', workflowRunId: 'workflow', revision: 3, status: 'completed' }
  vi.mocked(readHarnessState).mockResolvedValue(state as never)
  vi.mocked(applyHarnessOperation).mockImplementation(async (_ref, _id, operation) => ({ ...state,
    diagnostic: operation.type === 'record_diagnostic' ? operation.diagnostic : undefined }) as never)
  const result = { snapshot: state, steps: [], messages: [], outcome: 'finished' } as unknown as HarnessExecutionResult
  const reader = vi.fn(async () => { throw new Error('private database details') })
  expect(await readHarnessTranscriptForDelivery({ actorUserId: 'user', runId: 'root', workflowRunId: 'workflow' }, result, reader)).toBeUndefined()
  expect(result.snapshot.diagnostic).toMatchObject({ code: 'PERSISTENCE_FAILED', retryability: 'reconcile' })
  expect(JSON.stringify(result)).not.toContain('private database details')
  expect(reader).toHaveBeenCalledOnce()
})

test('a stale workflow cannot replace a successor transcript after a read failure', async () => {
  const { readHarnessState, applyHarnessOperation } = await import('./state-steps')
  vi.mocked(applyHarnessOperation).mockClear()
  vi.mocked(readHarnessState).mockResolvedValue({ workflowRunId: 'successor', executionGeneration: 1 } as never)
  const reader = vi.fn(async () => { throw new Error('database unavailable') })
  await expect(readHarnessTranscriptForDelivery({ actorUserId: 'user', runId: 'root', workflowRunId: 'workflow' }, {} as never, reader))
    .rejects.toThrow('authorization was revoked')
  expect(applyHarnessOperation).not.toHaveBeenCalled()
})


test('an internal-only settled step journals no empty-response placeholder', () => {
  const call = { type: 'tool-call', toolCallId: 'plan', toolName: 'harness_set_plan', input: {} }
  const result = { ...call, type: 'tool-result', output: { success: true } }
  expect(publicHarnessStepPersistence({ stepNumber: 0, text: '', reasoning: [],
    content: [call, result], toolCalls: [call], toolResults: [result] } as never, new Set()))
    .toEqual({ content: '', parts: [] })
})


test('tool-only journal rows retain work results without synthetic assistant narration', () => {
  const call = { type: 'tool-call', toolCallId: 'read', toolName: 'get_note', input: {} }
  const result = { ...call, type: 'tool-result', output: { title: 'Verified note' } }
  const persistence = publicHarnessStepPersistence({ stepNumber: 0, text: '', reasoning: [],
    content: [call, result], toolCalls: [call], toolResults: [result] } as never, new Set(['get_note']))
  expect(persistence.content).toBe('')
  expect(persistence.parts.map(part => part.type)).toEqual(['tool-invocation'])
  expect(JSON.stringify(persistence)).toContain('Verified note')
})

test('a tool attempt in a text-only progress phase contributes no public work row', () => {
  const call = { type: 'tool-call', toolCallId: 'bad-progress', toolName: 'create_note', input: {} }
  expect(publicHarnessStepPersistence({ stepNumber: 0, text: 'A malformed update', reasoning: [],
    content: [call], toolCalls: [call], toolResults: [] } as never, new Set(['create_note']), { textOnly: true }))
    .toEqual({ content: '', parts: [] })
})

test('a step cut off at its output cap is flagged and keeps the whitespace it stopped on', () => {
  const text = '22. The Thames Barrier.\n'
  const cut = publicHarnessStepPersistence({
    stepNumber: 0, text, finishReason: 'length', reasoning: [], toolCalls: [], toolResults: [],
    content: [{ type: 'text', text }],
  } as never, new Set())
  expect(cut).toEqual({ content: text, parts: [{ type: 'text', text }], outputLimitReached: true })
  const finished = publicHarnessStepPersistence({
    stepNumber: 0, text, finishReason: 'stop', reasoning: [], toolCalls: [], toolResults: [],
    content: [{ type: 'text', text }],
  } as never, new Set())
  expect(finished.outputLimitReached).toBeUndefined()
  expect(finished.content).toBe('22. The Thames Barrier.')
})

test('the saved transcript and final delivery continue a cut-off list as one block', async () => {
  const cut = '22. The Thames Barrier.\n23'
  const continued = '. The Tagus estuary barrier.\n24. The Maeslantkering.'
  const pageReader = vi.fn(async () => ({
    steps: [
      { receiptId: 'model:1', sequence: 1, stepNumber: 0, persistence: { content: continued, parts: [{ type: 'text', text: continued }] } },
      { receiptId: 'model:0', sequence: 0, stepNumber: 0, persistence: { content: cut, parts: [{ type: 'text', text: cut }], outputLimitReached: true } },
    ],
    cursor: '', isDone: true,
  }))
  const window = await readSettledHarnessTranscript({ actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' }, pageReader as never)
  expect(window.persistence.content).toBe(`${cut}${continued}`)
  expect(window.persistence.parts).toEqual([{ type: 'text', text: `${cut}${continued}` }])

  // The settled journal ends mid-output; the not-yet-journaled live step continues it.
  const cutWindow = { ...window, steps: window.steps.slice(0, 1),
    persistence: { content: cut, parts: [{ type: 'text', text: cut }] }, newestSequence: 0, oldestSequence: 0 }
  const result = {
    outcome: 'finished',
    snapshot: { runId: 'personal:run', status: 'completed', evidence: [], usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 } },
    messages: [],
    steps: [{ stepNumber: 0, text: continued, finishReason: 'stop', content: [{ type: 'text', text: continued }], toolCalls: [], toolResults: [] }],
    stepReceiptIds: ['model:1'],
  } as unknown as HarnessExecutionResult
  const delivery = buildPersonalHarnessDelivery(result, undefined, new Set(), cutWindow)
  expect(delivery.content).toBe(`${cut}${continued}`)
  expect(delivery.parts.filter(part => part.type === 'text').map(part => part.text)).toEqual([`${cut}${continued}`])
})
