import { beforeEach, expect, test, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { tool } from 'ai'
import type { LanguageModelV4FinishReason, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { z } from 'zod'
import * as state from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionPorts } from './ports'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { runOverlayHarness } from './runner'

vi.mock('@/server/ai/model-runtime', () => ({ getLanguageModel: vi.fn() }))
beforeEach(() => { vi.mocked(getLanguageModel).mockReset() })

type Call = { name: string; id: string; input: unknown }
const call = (name: string, id: string, input: unknown = {}): Call => ({ name, id, input })
const plan = [{ id: 'work', title: 'Read the records', dependsOn: [], acceptanceCriteria: ['Records read'], requiresVerification: false }]

function model(program: (index: number) => string | Call[], finishReasons: LanguageModelV4FinishReason['unified'][] = []) {
  let index = 0
  const provider = new MockLanguageModelV4({ doStream: async () => {
    const output = program(index++)
    const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }]
    if (typeof output === 'string') {
      parts.push({ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: output }, { type: 'text-end', id: 'text' })
    } else {
      parts.push(...output.map(item => ({ type: 'tool-call' as const, toolCallId: item.id, toolName: item.name, input: JSON.stringify(item.input) })))
    }
    parts.push({ type: 'finish',
      finishReason: { unified: finishReasons[index - 1] ?? (typeof output === 'string' ? 'stop' : 'tool-calls'), raw: 'fixture' },
      usage: { inputTokens: { total: 10, noCache: 2, cacheRead: 8, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
    })
    return { stream: new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close() } }) }
  }})
  vi.mocked(getLanguageModel).mockResolvedValue(provider)
  return provider
}

function fixture(requiresPlan = true) {
  let current = state.createHarnessSnapshot({ runId: 'run', goal: 'Read the requested records', constraints: [], policy: {
    actorUserId: 'user', allowedToolIds: ['read', 'write'], requiresPlan,
    deadlineAt: Date.now() + 60_000, maxCostMicros: 100, maxDepth: 1, maxParallelChildren: 2,
  } }, Date.now())
  const receipts = new Set<string>()
  const sdkSteps: number[] = []
  const ports: HarnessExecutionPorts = {
    claim: async () => { current = state.claimHarnessExecution(current, 'workflow', Date.now()); return true },
    read: async () => current,
    apply: async (_id, operation) => {
      const now = Date.now()
      switch (operation.type) {
        case 'reserve_model': current = state.reserveHarnessModel(current, operation.id, operation.maxCostMicros, now); break
        case 'replace_plan': current = state.replaceHarnessPlan(current, operation.steps, now); break
        case 'transition_step': current = state.transitionHarnessStep(current, operation, now); break
        case 'block': current = state.blockHarness(current, operation.blocker, now); break
        case 'resume': current = state.resumeHarness(current, now); break
        case 'checkpoint': current = state.checkpointHarness(current, operation.summary, now); break
        case 'finish': current = state.finishHarness(current, now); break
        case 'terminate': current = state.terminateHarness(current, operation.status, operation.reason, now); break
        case 'wait_for_children': current = state.waitForHarnessChildren(current, now); break
        default: throw new Error(`Unexpected fixture operation: ${operation.type}`)
      }
      return current
    },
    readEvidence: async id => current.evidence.find(item => item.id === id) ?? null,
    authorizeTool: vi.fn(async () => undefined),
    prepareModel: async input => ({ messages: input.messages, activeToolNames: input.toolNames, estimatedCostMicros: 0 }),
    recordModelStep: async (step, id) => {
      sdkSteps.push(step.stepNumber)
      expect(receipts.has(id)).toBe(false)
      receipts.add(id)
      current = state.recordHarnessReceipt(current, {
        id, modelId: 'fixture/model', provider: 'fixture', inputTokens: step.usage.inputTokens ?? 0,
        outputTokens: step.usage.outputTokens ?? 0, reasoningTokens: 0, cacheReadTokens: step.usage.inputTokenDetails.cacheReadTokens ?? 0,
        cacheWriteTokens: 0, contextWindow: 1000, costMicros: 0,
      }, Date.now())
    },
    recordToolResult: async event => {
      if (['completed', 'cancelled', 'failed'].includes(current.status)) return
      current = state.recordHarnessEvidence(current, {
        id: `tool:${event.toolCall.toolCallId}`, kind: 'tool_result', source: event.toolCall.toolName,
        summary: event.success ? JSON.stringify(event.output) : 'Tool failed', verdict: event.success ? 'observed' : 'failed', createdAt: Date.now(),
      }, Date.now())
    },
    delegate: async () => { throw new Error('Unexpected delegation') },
    readChild: async () => { throw new Error('Unexpected child read') },
    waitForChildren: async () => { throw new Error('Unexpected child wait') },
    waitForInput: async () => null,
    waitForApproval: async () => null,
  }
  return { ports, receipts, sdkSteps }
}

const input = { instructions: 'Use the tools to perform the requested work.', messages: [{ role: 'user' as const, content: 'Read the records.' }], model: { modelId: 'fixture/model', credentialOwnerId: 'user' } }

test('the real SDK runs beyond twenty tool calls and continues after early sign-off', async () => {
  const f = fixture()
  let prepared = false
  f.ports.prepareModel = async request => {
    if (!prepared) {
      prepared = true
      await f.ports.apply('context-summary', { type: 'checkpoint', summary: 'Preserve the original constraints after compaction.' })
    }
    return { messages: request.messages, activeToolNames: request.toolNames, estimatedCostMicros: 0 }
  }
  let reads = 0
  const provider = model(index => {
    if (index === 0) return [call('harness_set_plan', 'plan', { steps: plan })]
    if (index === 10) return 'An early response, with work still unfinished.'
    if (reads < 24) return [call('read', `read-${reads + 1}`)]
    if (index === 26) return [call('harness_update_step', 'complete', { id: 'work', status: 'done', evidenceRefs: ['tool:read-24'] })]
    return 'All requested records were read.'
  })
  const result = await runOverlayHarness({ ...input, tools: { read: tool({ inputSchema: z.object({}), execute: async () => ({ record: ++reads }) }) } }, f.ports)
  expect(result.snapshot.status).toBe('completed')
  expect(reads).toBe(24)
  expect(provider.doStreamCalls.length).toBeGreaterThan(20)
  expect(f.sdkSteps.some(step => step >= 10)).toBe(true)
  expect(result.snapshot.continuations).toBeGreaterThan(0)
  expect(JSON.stringify(provider.doStreamCalls[0].prompt)).toContain('Preserve the original constraints after compaction.')
  expect(result.snapshot.workingSummary).toBe('Preserve the original constraints after compaction.')
  expect(provider.doStreamCalls.every(options => options.prompt.filter(message => message.role === 'system').length === 1)).toBe(true)
  expect(f.receipts.size).toBe(provider.doStreamCalls.length)
  expect(result.snapshot.usage.cacheReadTokens).toBe(provider.doStreamCalls.length * 8)
})

test('input blockers suspend without an extra model call and resume with the real reply', async () => {
  const f = fixture(false)
  const provider = model(index => index === 0 ? [call('harness_report_blocker', 'input', { question: 'Which currency?' })] : 'Use USD.')
  f.ports.waitForInput = async current => {
    expect(current.status).toBe('waiting_for_input')
    expect(provider.doStreamCalls).toHaveLength(1)
    return [{ role: 'user', content: 'USD' }]
  }
  const result = await runOverlayHarness({ ...input, tools: {} }, f.ports)
  expect(result.snapshot.status).toBe('completed')
  expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('USD')
})

test('an output-token limit continues the partial response instead of marking an unplanned answer complete', async () => {
  const f = fixture(false)
  const provider = model(index => index === 0 ? 'The first part' : 'and the remaining answer.', ['length', 'stop'])
  const result = await runOverlayHarness({ ...input, tools: {} }, f.ports)
  expect(result.snapshot.status).toBe('completed')
  expect(provider.doStreamCalls).toHaveLength(2)
  expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('reached its output limit, not task completion')
  expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('The first part')
  expect(f.receipts.size).toBe(2)
})

test.each(['content-filter', 'error', 'other'] as const)('a provider %s finish cannot become successful completion', async finishReason => {
  const f = fixture(false)
  const provider = model(() => 'Partial response', [finishReason])
  const result = await runOverlayHarness({ ...input, tools: {} }, f.ports)
  expect(result.snapshot.status).toBe('failed')
  expect(result.snapshot.terminalReason).toContain(finishReason)
  expect(provider.doStreamCalls).toHaveLength(1)
  expect(f.receipts.size).toBe(1)
})

test('the model reservation remains held while its returned tools execute', async () => {
  const f = fixture()
  f.ports.prepareModel = async request => ({ messages: request.messages, activeToolNames: request.toolNames, estimatedCostMicros: 60 })
  model(index => {
    if (index === 0) return [call('harness_set_plan', 'plan', { steps: plan })]
    if (index === 1) return [call('read', 'read')]
    if (index === 2) return [call('harness_update_step', 'done', { id: 'work', status: 'done', evidenceRefs: ['tool:read'] })]
    return 'Finished.'
  })
  const execute = vi.fn(async () => {
    const current = await f.ports.read()
    expect(current.modelReservation).toEqual({ id: 'model:1', maxCostMicros: 60 })
    expect(() => state.admitHarnessChild(current, {
      id: 'child', stepId: 'work', allowedToolIds: ['read'], maxCostMicros: 50, costMicros: 0, status: 'running', evidenceRefs: [],
    }, Date.now())).toThrow(/spending/)
    return 'Read source.'
  })
  const result = await runOverlayHarness({ ...input, tools: { read: tool({ inputSchema: z.object({}), execute }) } }, f.ports)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(result.snapshot.status).toBe('completed')
  expect(result.snapshot.modelReservation).toBeUndefined()
})

test.each([true, false])('SDK approvals reconstruct the request/response protocol, approved=%s', async approved => {
  const f = fixture(false)
  const execute = vi.fn(async () => 'Changed')
  model(index => index === 0 ? [call('write', 'write')] : 'The decision was applied.')
  f.ports.waitForApproval = async requests => {
    expect(execute).not.toHaveBeenCalled()
    return requests.map(request => ({ approvalId: request.approvalId, approved }))
  }
  const result = await runOverlayHarness({ ...input, tools: { write: tool({ inputSchema: z.object({}), needsApproval: true, execute }) } }, f.ports)
  expect(execute).toHaveBeenCalledTimes(approved ? 1 : 0)
  expect(result.snapshot.status).toBe('completed')
})

test('revoked tool authority is checked again after an approved wait', async () => {
  const f = fixture(false)
  const execute = vi.fn(async () => 'Changed')
  model(index => index === 0 ? [call('write', 'write')] : 'The action could not be performed.')
  f.ports.waitForApproval = async requests => {
    f.ports.authorizeTool = async () => { throw new Error('Access revoked') }
    return requests.map(request => ({ approvalId: request.approvalId, approved: true }))
  }
  await runOverlayHarness({ ...input, tools: { write: tool({ inputSchema: z.object({}), needsApproval: true, execute }) } }, f.ports)
  expect(execute).not.toHaveBeenCalled()
})

test('cancellation after a tool prevents another model call', async () => {
  const f = fixture(false)
  const provider = model(() => [call('read', 'read')])
  const result = await runOverlayHarness({ ...input, tools: { read: tool({ inputSchema: z.object({}), execute: async () => {
    await f.ports.apply('cancel', { type: 'terminate', status: 'cancelled', reason: 'User stopped.' })
    return 'Stopped'
  } }) } }, f.ports)
  expect(result.snapshot.status).toBe('cancelled')
  expect(provider.doStreamCalls).toHaveLength(1)
})

test('provider failure takes precedence over waiting for children', async () => {
  const f = fixture(false)
  const record = f.ports.recordModelStep
  f.ports.recordModelStep = async (step, receiptId) => {
    await record(step, receiptId)
    const current = await f.ports.read()
    current.children.push({ id: 'child', stepId: 'work', allowedToolIds: [], maxCostMicros: 0, costMicros: 0,
      status: 'running', evidenceRefs: [] })
  }
  f.ports.waitForChildren = vi.fn()
  const provider = model(() => 'Unable to continue.', ['content-filter'])
  const result = await runOverlayHarness({ ...input, tools: {} }, f.ports)
  expect(result.snapshot.status).toBe('failed')
  expect(f.ports.waitForChildren).not.toHaveBeenCalled()
  expect(provider.doStreamCalls).toHaveLength(1)
})

test('budget refusal happens before contacting the model', async () => {
  const f = fixture()
  const provider = model(() => 'Must not run')
  f.ports.prepareModel = async args => ({ messages: args.messages, activeToolNames: [], estimatedCostMicros: 101 })
  const result = await runOverlayHarness({ ...input, tools: {} }, f.ports)
  expect(result.snapshot.blocker?.kind).toBe('budget')
  expect(provider.doStreamCalls).toHaveLength(0)
})

test('repeated natural returns without progress become an explicit blocker, not success', async () => {
  const f = fixture()
  const provider = model(() => 'Done, without actually making the required plan.')
  const result = await runOverlayHarness({ ...input, tools: {} }, f.ports)
  expect(result.outcome).toBe('blocked')
  expect(result.snapshot.blocker?.kind).toBe('stuck')
  expect(provider.doStreamCalls).toHaveLength(2)
})
