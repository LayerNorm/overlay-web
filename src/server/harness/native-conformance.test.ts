import { beforeEach, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { tool } from 'ai'
import { z } from 'zod'
import type { LanguageModelV4FinishReason, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import * as runtime from '@overlay/agent-runtime/harness-state'
import { harnessToolsRequirePlan } from './write-tools'
import type { HarnessExecutionPorts } from './ports'
import { buildPersonalHarnessDelivery } from './personal-delivery'
import { runOverlayHarness } from './runner'
import { createHarnessTools } from './tools'
import { createHarnessToolApprovals } from './tool-approvals'
import { createNativeHarnessTools } from './native-tools'
import { finishNativeHarnessDelivery } from './native-delivery-steps'
import { projectNativeHarnessToolProgress } from './native-tool-progress'
import { AgentAskError, AgentAskService } from '@/server/agents/agent-asks/AgentAskService'
import { startWorkspaceAgentTurns } from '@/server/agents/start-agent-turns'
import { prepareWorkspaceAgentTurn } from '@/server/agents/workspace-agent-durable'
import { agentMemoryOwnerId } from '@/shared/agents/agent-memory'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'

const mocks = vi.hoisted(() => ({
  getLanguageModel: vi.fn(),
  getLatestAgentRun: vi.fn(),
  reserveForAttempt: vi.fn(),
  executeNativeHarnessTool: vi.fn(),
  nativeHarnessToolNeedsApproval: vi.fn(),
  refreshNativeHarnessAccess: vi.fn(),
  persistAgentToolProgress: vi.fn(),
  listMessages: vi.fn(),
  finalizeAgentMessage: vi.fn(),
  enqueueMemoryExtraction: vi.fn(),
  completeAgentRun: vi.fn(),
  failAgentRun: vi.fn(),
  nativeState: null as unknown,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/server/ai/model-runtime', () => ({ getLanguageModel: mocks.getLanguageModel }))
vi.mock('@/server/bootstrap', () => ({
  getOverlayServerContext: () => ({
    appData: {
      repositories: {
        conversations: { getLatestAgentRun: mocks.getLatestAgentRun },
        conversationCollaboration: {
          listMessages: mocks.listMessages,
          finalizeAgentMessage: mocks.finalizeAgentMessage,
          enqueueMemoryExtraction: mocks.enqueueMemoryExtraction,
        },
      },
    },
    chatUsagePolicy: { reserveForAttempt: mocks.reserveForAttempt },
  }),
}))
vi.mock('@/server/conversations/ActConversationRepository', () => ({ asConversationId: (id: string) => id }))
vi.mock('@/server/conversations/http', () => ({
  agentRunService: {
    complete: mocks.completeAgentRun,
    fail: mocks.failAgentRun,
  },
}))
vi.mock('./native-tool-steps', () => ({
  executeNativeHarnessTool: mocks.executeNativeHarnessTool,
  nativeHarnessToolNeedsApproval: mocks.nativeHarnessToolNeedsApproval,
  dispatchNativeHarnessAgentRequest: vi.fn(),
}))
vi.mock('./native-access', () => ({
  refreshNativeHarnessAccess: mocks.refreshNativeHarnessAccess,
}))
vi.mock('@/server/agents/agent-message-stream', () => ({
  persistAgentToolProgress: mocks.persistAgentToolProgress,
}))
vi.mock('./ConvexHarnessRepository', () => ({
  ConvexHarnessRepository: class {
    async get() {
      return mocks.nativeState
    }
  },
}))

type Call = { name: string; id: string; input?: unknown }

function model(program: (index: number) => string | Call[], finishReasons: LanguageModelV4FinishReason['unified'][] = []) {
  let index = 0
  const provider = new MockLanguageModelV4({
    doStream: async () => {
      const output = program(index++)
      const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }]
      if (typeof output === 'string') {
        parts.push({ type: 'text-start', id: `text-${index}` })
        parts.push({ type: 'text-delta', id: `text-${index}`, delta: output })
        parts.push({ type: 'text-end', id: `text-${index}` })
      } else {
        parts.push(...output.map(item => ({
          type: 'tool-call' as const,
          toolCallId: item.id,
          toolName: item.name,
          input: JSON.stringify(item.input ?? {}),
        })))
      }
      parts.push({
        type: 'finish',
        finishReason: {
          unified: finishReasons[index - 1] ?? (typeof output === 'string' ? 'stop' : 'tool-calls'),
          raw: 'fixture',
        },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
      })
      return {
        stream: new ReadableStream({
          start(controller) {
            parts.forEach(part => controller.enqueue(part))
            controller.close()
          },
        }),
      }
    },
  })
  mocks.getLanguageModel.mockResolvedValue(provider)
  return provider
}

function harnessFixture(options: { allowedToolIds?: string[]; requiresPlan?: boolean } = {}) {
  const allowedToolIds = options.allowedToolIds ?? ['read_file', 'write_file']
  let current = runtime.createHarnessSnapshot({
    runId: 'workspace:run',
    goal: 'Complete the requested work.',
    constraints: [],
    policy: {
      actorUserId: 'human',
      workspaceId: 'workspace',
      allowedToolIds,
      requiresPlan: options.requiresPlan ?? harnessToolsRequirePlan(allowedToolIds),
      deadlineAt: Date.now() + 60_000,
      maxCostMicros: 100,
      maxParallelChildren: 2,
      maxDepth: 2,
    },
  }, Date.now())
  const calls: Array<{ kind: 'model' | 'tool'; name?: string }> = []
  const ports: HarnessExecutionPorts = {
    claim: async () => {
      current = runtime.claimHarnessExecution(current, 'workflow', Date.now())
      return true
    },
    read: async () => current,
    apply: async (_id, operation) => {
      const now = Date.now()
      switch (operation.type) {
        case 'reserve_model':
          current = runtime.reserveHarnessModel(current, operation.id, operation.maxCostMicros, now)
          break
        case 'replace_plan':
          current = runtime.replaceHarnessPlan(current, operation.steps, now)
          break
        case 'transition_step':
          current = runtime.transitionHarnessStep(current, operation, now)
          break
        case 'block':
          current = runtime.blockHarness(current, operation.blocker, now)
          break
        case 'resume':
          current = runtime.resumeHarness(current, now)
          break
        case 'checkpoint':
          current = runtime.checkpointHarness(current, operation.summary, now)
          break
        case 'finish':
          current = runtime.finishHarness(current, now, operation.resultSummary)
          break
        case 'terminate':
          current = runtime.terminateHarness(current, operation.status, operation.reason, now)
          break
        case 'wait_for_children':
          current = runtime.waitForHarnessChildren(current, now)
          break
        default:
          throw new Error(`Unexpected operation ${operation.type}`)
      }
      return current
    },
    readEvidence: async id => current.evidence.find(item => item.id === id) ?? null,
    authorizeTool: async () => undefined,
    prepareModel: async request => ({
      messages: request.messages,
      instructions: request.instructions,
      activeToolNames: request.toolNames.filter(name => current.policy.allowedToolIds.includes(name)),
      estimatedCostMicros: 0,
    }),
    recordModelStep: async (step, id) => {
      calls.push({ kind: 'model' })
      current = runtime.recordHarnessReceipt(current, {
        id,
        modelId: 'fixture/model',
        provider: 'fixture',
        inputTokens: step.usage.inputTokens ?? 0,
        outputTokens: step.usage.outputTokens ?? 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        contextWindow: 1_000,
        costMicros: 0,
      }, Date.now())
    },
    recordToolResult: async event => {
      calls.push({ kind: 'tool', name: event.toolCall.toolName })
      current = runtime.recordHarnessEvidence(current, {
        id: `tool:${event.toolCall.toolCallId}`,
        kind: 'tool_result',
        source: event.toolCall.toolName,
        summary: event.success ? JSON.stringify(event.output) : 'failed',
        verdict: event.success ? 'observed' : 'failed',
        createdAt: Date.now(),
      }, Date.now())
    },
    delegate: async () => { throw new Error('unexpected delegate') },
    readChild: async () => { throw new Error('unexpected child') },
    waitForChildren: async () => { throw new Error('unexpected child wait') },
    waitForInput: async () => null,
    waitForApproval: async () => null,
  }
  return {
    ports,
    read: () => current,
    calls,
    run: (tools: Record<string, unknown> = {}) => runOverlayHarness({
      actorUserId: 'human',
      access: { actorUserId: 'human', runId: 'workspace:run', workflowRunId: 'workflow' },
      instructions: 'Complete the task.',
      messages: [{ role: 'user', content: 'Do it.' }],
      model: { modelId: 'fixture/model', native: undefined },
      tools: tools as never,
      settings: { maxSteps: 32 },
    }, ports),
  }
}

const definition = (name: string) => ({
  name,
  description: name,
  inputSchema: { type: 'object', properties: {}, additionalProperties: true },
})

function agent(id: string, name: string, extra: Partial<WorkspaceAgentDirectoryItem> = {}): WorkspaceAgentDirectoryItem {
  return {
    id,
    name,
    principalId: `principal-${id}`,
    workspaceId: 'workspace',
    instructions: '',
    harness: 'overlay',
    modelId: 'fixture/model',
    allowedToolIds: [],
    invocationPolicy: 'mention',
    visibility: 'workspace',
    createdByPrincipalId: 'human',
    createdAt: 0,
    updatedAt: 0,
    teamIds: [],
    roomCount: 0,
    ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLatestAgentRun.mockResolvedValue(null)
  mocks.reserveForAttempt.mockResolvedValue({ ok: true, reservationId: 'reservation' })
  mocks.nativeHarnessToolNeedsApproval.mockResolvedValue(false)
  mocks.executeNativeHarnessTool.mockResolvedValue({ success: true, value: 'read' })
  mocks.refreshNativeHarnessAccess.mockResolvedValue({ agent: { id: 'agent', principalId: 'agent-principal' } })
  mocks.enqueueMemoryExtraction.mockResolvedValue(undefined)
  mocks.listMessages.mockResolvedValue([])
  mocks.nativeState = null
})

it('Identity — authenticates tools as the human, assigns memory to the agent, and authors the final delivery as the agent', async () => {
  const fixture = harnessFixture({ allowedToolIds: ['read_file'] })
  const access = {
    actorUserId: 'human',
    runId: 'workspace:run',
    workflowRunId: 'workflow',
    workspaceId: 'workspace',
    principalId: 'human-principal',
    agentId: 'agent',
    agentPrincipalId: 'agent-principal',
    conversationId: 'room',
    agentRunId: 'agent-run',
    userMessageId: 'question',
    assistantMessageId: 'answer',
    turnId: 'turn',
  }
  const tools = createNativeHarnessTools({
    access,
    context: { modelId: 'fixture/model', memoryEnabled: true, sharedRoom: true, requestFingerprint: 'request' },
    definitions: [definition('read_file')],
  })
  model(index => index === 0 ? [{ name: 'read_file', id: 'read-1' }] : 'done')
  const result = await fixture.run(tools)
  expect(result.snapshot.status).toBe('completed')
  expect(mocks.executeNativeHarnessTool).toHaveBeenCalledWith(expect.objectContaining({
    access: expect.objectContaining({ actorUserId: 'human', agentId: 'agent' }),
    context: expect.objectContaining({ memoryEnabled: true }),
    toolName: 'read_file',
    toolCallId: 'read-1',
  }), false)

  const persistence = buildPersonalHarnessDelivery({
    snapshot: result.snapshot,
    messages: result.messages,
    steps: result.steps,
  } as never)
  expect(persistence.parts.some(part => part.type === 'tool-invocation')).toBe(true)
  mocks.nativeState = {
    runId: 'workspace:agent-run',
    workflowRunId: 'workflow',
    policy: { actorUserId: 'human', workspaceId: 'workspace' },
    status: 'completed',
  }
  mocks.getLatestAgentRun.mockResolvedValue({
    id: 'agent-run', userId: 'human', conversationId: 'room', agentId: 'agent',
    agentPrincipalId: 'agent-principal', turnId: 'turn', userMessageId: 'question',
    assistantMessageId: 'answer', mode: 'room', runner: 'workflow', executionEngine: 'overlay_harness',
    harnessRunId: 'workspace:agent-run', workflowRunId: 'workflow',
  })
  await finishNativeHarnessDelivery(access, persistence, { memoryEnabled: true })
  expect(mocks.finalizeAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
    actorUserId: 'human', conversationId: 'room', messageId: 'answer',
  }))
  expect(mocks.enqueueMemoryExtraction).toHaveBeenCalledWith(expect.objectContaining({
    memoryOwnerId: agentMemoryOwnerId('agent'), targetActor: 'agent', turnId: 'turn',
  }))
})

it('Revocation mid-run — the next step fails closed and cannot complete or write another room result', async () => {
  const fixture = harnessFixture()
  const tools = createHarnessTools([definition('read_file')], {
    needsApproval: async () => false,
    execute: async () => 'read',
  })
  model(index => index === 0
    ? [{
      name: 'harness_set_plan',
      id: 'plan',
      input: { steps: [{
        id: 'read',
        title: 'Read source',
        dependsOn: [],
        acceptanceCriteria: ['Read the source.'],
        requiresVerification: false,
      }] },
    }]
    : [{ name: 'read_file', id: 'read-1' }])
  const originalPrepare = fixture.ports.prepareModel
  fixture.ports.prepareModel = async request => {
    if (fixture.calls.filter(call => call.kind === 'model').length > 0) {
      throw new Error('Native room participation was revoked.')
    }
    return originalPrepare(request)
  }
  await expect(fixture.run(tools)).rejects.toThrow('revoked')
  expect(fixture.calls.filter(call => call.kind === 'model')).toHaveLength(1)
  expect(fixture.read().status).not.toBe('completed')
})

it('Grants — offered tools are intersected with policy and disallowed model calls cannot execute', async () => {
  const fixture = harnessFixture({ allowedToolIds: ['read_file'] })
  const executed: string[] = []
  const tools = createHarnessTools([definition('read_file'), definition('write_file')], {
    needsApproval: async () => false,
    execute: async call => {
      executed.push(call.toolName)
      return 'ok'
    },
  })
  model(() => [{ name: 'write_file', id: 'write-1' }])
  const result = await fixture.run(tools)
  expect(result.outcome).toBe('blocked')
  expect(executed).toEqual([])
  expect(fixture.read().status).not.toBe('completed')
})

it('Approval — durable decisions match tool identity and input, execute once, and reject replay', async () => {
  const approvals = createHarnessToolApprovals()
  approvals.record([{ approvalId: 'approval', toolCallId: 'call-1', toolName: 'write_file', input: { path: 'a' } }], [
    { approvalId: 'approval', approved: true },
  ])
  expect(approvals.consume('write_file', 'wrong-call', { path: 'a' })).toBe(false)
  const exact = createHarnessToolApprovals()
  exact.record([{ approvalId: 'approval', toolCallId: 'call-1', toolName: 'write_file', input: { path: 'a' } }], [
    { approvalId: 'approval', approved: true },
  ])
  expect(exact.consume('write_file', 'call-1', { path: 'wrong' })).toBe(false)
  const replay = createHarnessToolApprovals()
  replay.record([{ approvalId: 'approval', toolCallId: 'call-1', toolName: 'write_file', input: { path: 'a' } }], [
    { approvalId: 'approval', approved: true },
  ])
  expect(replay.consume('write_file', 'call-1', { path: 'a' })).toBe(true)
  expect(replay.consume('write_file', 'call-1', { path: 'a' })).toBe(false)
})

it('Model — candidate routing can recover from an unavailable entitled model and never calls a provider without entitlement', async () => {
  const candidates = ['unavailable/model', 'entitled/fallback']
  let calls = 0
  const route = async (entitled: string[]) => {
    for (const candidate of candidates) {
      if (!entitled.includes(candidate)) continue
      calls++
      if (candidate === 'unavailable/model') continue
      return candidate
    }
    return null
  }
  expect(await route(candidates)).toBe('entitled/fallback')
  expect(calls).toBe(2)
  calls = 0
  expect(await route([])).toBeNull()
  expect(calls).toBe(0)
})

it('Streaming — live text/tool parts arrive before finalization, and final persistence strips reasoning and duplicates', async () => {
  const fixture = harnessFixture({ allowedToolIds: ['read_file'] })
  const tools = createHarnessTools([definition('read_file')], {
    needsApproval: async () => false,
    execute: async () => ({ ok: true }),
  })
  model(index => index === 0 ? [{ name: 'read_file', id: 'read-1' }] : 'final')
  const result = await fixture.run(tools)
  expect(fixture.calls.some(call => call.kind === 'tool')).toBe(true)
  const streamAccess = {
    actorUserId: 'human', runId: 'workspace:agent-run', workflowRunId: 'workflow', workspaceId: 'workspace',
    agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room',
    agentRunId: 'agent-run', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn',
  }
  const streamContext = { modelId: 'fixture/model', memoryEnabled: true, sharedRoom: true, requestFingerprint: 'request' }
  mocks.listMessages.mockResolvedValue([{
    _id: 'answer', turnId: 'turn', authorKind: 'agent', authorPrincipalId: 'agent-principal', status: 'generating',
    parts: [{ type: 'reasoning', text: 'hidden' }],
  }])
  await projectNativeHarnessToolProgress(streamAccess, streamContext, {
    toolCallId: 'read-1', toolName: 'read_file', input: {}, state: 'input-available',
  })
  await projectNativeHarnessToolProgress(streamAccess, streamContext, {
    toolCallId: 'read-1', toolName: 'read_file', input: {}, state: 'output-available', output: 'read',
  })
  await projectNativeHarnessToolProgress({ ...streamAccess, runId: 'child:run' }, streamContext, {
    toolCallId: 'anonymous', toolName: 'read_file', input: {}, state: 'input-available',
  })
  expect(mocks.persistAgentToolProgress).toHaveBeenCalledTimes(2)
  expect(mocks.persistAgentToolProgress.mock.calls[1][0].parts).toEqual([expect.objectContaining({
    type: 'tool-invocation',
    toolInvocation: expect.objectContaining({ toolCallId: 'read-1', state: 'output-available' }),
  })])
  const delivery = buildPersonalHarnessDelivery({
    snapshot: result.snapshot,
    messages: [
      ...result.messages,
      { role: 'assistant', content: [{ type: 'reasoning', text: 'secret' }] },
    ],
    steps: result.steps,
  } as never)
  expect(delivery.parts.filter(part => part.type === 'reasoning')).toHaveLength(0)
  const toolIds = delivery.parts
    .filter(part => part.type === 'tool-invocation')
    .map(part => (part as { toolInvocation?: { toolCallId?: string } }).toolInvocation?.toolCallId)
  expect(new Set(toolIds).size).toBe(toolIds.length)
})

it('Plan: write claims without a plan stay blocked, while answer-only Q&A completes', async () => {
  const writeFixture = harnessFixture({ allowedToolIds: ['write_file'] })
  const writeTools = createHarnessTools([definition('write_file')], {
    needsApproval: async () => false,
    execute: async () => 'created',
  })
  const textOnly = model(() => 'I created notes 01 through 08 with IDs.')
  const blocked = await writeFixture.run(writeTools)
  expect(blocked.outcome).toBe('blocked')
  expect(blocked.snapshot.status).not.toBe('completed')
  expect(blocked.snapshot.blocker?.kind).toBe('stuck')
  expect(textOnly.doStreamCalls).toHaveLength(2)
  expect(textOnly.doStreamCalls[0]?.toolChoice).toEqual({ type: 'required' })

  const qaFixture = harnessFixture({ allowedToolIds: ['write_file'] })
  const answer = model(index => index === 0
    ? [{
      name: 'harness_set_plan',
      id: 'answer-plan',
      input: { steps: [{
        id: 'answer',
        title: 'Answer from knowledge',
        dependsOn: [],
        acceptanceCriteria: ['Answer the question.'],
        requiresVerification: false,
        answerOnly: true,
      }] },
    }]
    : 'Here is the answer based on prior knowledge.')
  const completed = await qaFixture.run(writeTools)
  expect(completed.snapshot.status).toBe('completed')
  expect(completed.snapshot.plan[0]).toMatchObject({ id: 'answer', answerOnly: true, status: 'done' })
  expect(answer.doStreamCalls[0]?.toolChoice).toEqual({ type: 'required' })
  expect(answer.doStreamCalls[1]?.toolChoice).toEqual({ type: 'none' })
})

it('Budget — two named children plus the parent remain within the ceiling and a third ask is refused before a turn row', () => {
  const parent = runtime.createHarnessSnapshot({
    runId: 'parent',
    goal: 'delegate',
    constraints: [],
    policy: {
      actorUserId: 'human',
      allowedToolIds: [],
      requiresPlan: false,
      deadlineAt: Date.now() + 60_000,
      maxCostMicros: 100,
      maxParallelChildren: 2,
      maxDepth: 2,
    },
  }, Date.now())
  const first = runtime.admitHarnessNamedChild(parent, {
    id: 'child-1', stepId: 'one', allowedToolIds: [], maxCostMicros: 33, costMicros: 0, status: 'running', evidenceRefs: [],
  }, { title: 'one', acceptanceCriteria: ['one'] }, Date.now())
  const second = runtime.admitHarnessNamedChild(first, {
    id: 'child-2', stepId: 'two', allowedToolIds: [], maxCostMicros: 33, costMicros: 0, status: 'running', evidenceRefs: [],
  }, { title: 'two', acceptanceCriteria: ['two'] }, Date.now())
  expect(second.children).toHaveLength(2)
  expect(second.children.reduce((sum, child) => sum + child.maxCostMicros, 0)).toBeLessThanOrEqual(66)
  expect(() => runtime.admitHarnessNamedChild(second, {
    id: 'child-3', stepId: 'three', allowedToolIds: [], maxCostMicros: 33, costMicros: 0, status: 'running', evidenceRefs: [],
  }, { title: 'three', acceptanceCriteria: ['three'] }, Date.now())).toThrow()
})

it('Stop — cancellation propagates through anonymous and cross-room descendants without completing a cancelled run', () => {
  const root = runtime.createHarnessSnapshot({
    runId: 'root',
    goal: 'stop',
    constraints: [],
    policy: { actorUserId: 'human', allowedToolIds: [], requiresPlan: false, deadlineAt: Date.now() + 60_000, maxCostMicros: 100, maxParallelChildren: 3, maxDepth: 2 },
  }, Date.now())
  const child = runtime.admitHarnessNamedChild(root, {
    id: 'anonymous', stepId: 'anonymous', allowedToolIds: [], maxCostMicros: 10, costMicros: 0, status: 'running', evidenceRefs: [],
  }, { title: 'anonymous', acceptanceCriteria: ['stop'] }, Date.now())
  const stopped = runtime.terminateHarness(child, 'cancelled', 'Stopped by the user.', Date.now())
  expect(stopped.status).toBe('cancelled')
  expect(() => runtime.finishHarness(stopped, Date.now(), 'late completion')).toThrow()
})

it('Lineage — depth, cycles, and external targets are refused before dispatch', async () => {
  const tooDeep = runtime.createHarnessSnapshot({
    runId: 'deep',
    goal: 'deep',
    constraints: [],
    depth: 2,
    policy: { actorUserId: 'human', allowedToolIds: [], requiresPlan: false, deadlineAt: Date.now() + 60_000, maxCostMicros: 10, maxParallelChildren: 1, maxDepth: 2 },
  }, Date.now())
  expect(() => runtime.admitHarnessChild(tooDeep, {
    id: 'grandchild', stepId: 'grandchild', allowedToolIds: [], maxCostMicros: 1, costMicros: 0, status: 'running', evidenceRefs: [],
  }, 'grandchild', [], Date.now())).toThrow()

  const directory = [agent('caller', 'Caller'), agent('target', 'Target')]
  const service = new AgentAskService({
    collaboration: {
      listMessages: async () => [{ _id: 'trigger', authorKind: 'human', turnId: 'human-turn' }] as never,
      createDirectMessage: async () => ({ conversationId: 'room' }) as never,
      addAgentMessage: async () => 'message',
      getAccessibleConversation: async () => ({ conversationType: 'channel' }) as never,
      listParticipants: async () => [{ principalId: 'principal-caller' }, { principalId: 'principal-target' }] as never,
      addMessage: async () => 'message',
    },
    getCallerRun: async () => null,
    directory: async () => directory,
    claimBudget: async () => ({ ok: true }),
    releaseBudget: async () => undefined,
    recordReply: async () => undefined,
    listReplies: async () => [],
    startTurns: async () => [{ agentId: 'target', turnId: 'target-turn' }],
  })
  await expect(service.ask({
    actorUserId: 'human', actorPrincipalId: 'human', workspaceId: 'workspace',
    caller: { agentId: 'caller', conversationId: 'room', turnId: 'agent_trigger_caller' },
    target: 'Caller', message: 'cycle', wait: false,
  })).rejects.toMatchObject({ code: 'ask_self' } satisfies Partial<AgentAskError>)
  await expect(service.ask({
    actorUserId: 'human', actorPrincipalId: 'human', workspaceId: 'workspace',
    caller: { agentId: 'caller', conversationId: 'room', turnId: 'agent_trigger_caller' },
    target: 'Target', message: 'external', wait: false,
    startTurns: async () => { throw new Error("External agents can't be asked from this run yet.") },
  })).rejects.toThrow("External agents can't be asked from this run yet.")
})

it('Legacy — legacy rows keep the old dispatcher under either flag, while native-owned rows fail closed', async () => {
  const invocation = {
    agentId: 'agent', agentName: 'Agent', agentPrincipalId: 'principal-agent', invocationNonce: 'nonce',
    modelId: 'fixture/model', harness: 'overlay' as const, externalAgent: false, turnId: 'turn',
  }
  const run = async (enabled: boolean) => {
    const starts: string[] = []
    await startWorkspaceAgentTurns({
      actorUserId: 'human', conversationId: 'room', messageId: 'message', mentionedPrincipalIds: [], initiatorPrincipalId: 'human',
      prompt: 'work', memoryEnabled: false, turnId: 'human-turn', workspaceId: 'workspace',
    }, {
      nativeHarnessEnabled: () => enabled,
      resolveInvocations: async () => [invocation],
      getCollaboration: () => ({
        enqueueMemoryExtraction: async () => undefined,
        startAgentTurn: async (input: Record<string, unknown>) => ({ resumed: false, runId: 'run', messageId: 'reply', ...input }),
        startAgentMessage: async () => 'failure',
        failAgentMessage: async () => undefined,
      } as never),
      startWorkflow: async () => { starts.push('legacy') },
      startNative: async () => { starts.push('native') },
    })
    return starts
  }
  expect(await run(false)).toEqual(['legacy'])
  expect(await run(true)).toEqual(['native'])
  mocks.getLatestAgentRun.mockResolvedValue({ executionEngine: 'overlay_harness' })
  await expect(prepareWorkspaceAgentTurn({
    actorUserId: 'human', agentId: 'agent', conversationId: 'room', messageId: 'message',
    memoryEnabled: true, runId: 'run', turnMessageId: 'reply', workspaceId: 'workspace',
  })).rejects.toThrow('native Harness workflow')
  expect(mocks.reserveForAttempt).not.toHaveBeenCalled()
})

it('Unbounded loop — more tool calls than legacy maxSteps complete, and premature done continues while plan work remains', async () => {
  const fixture = harnessFixture({ requiresPlan: true })
  await fixture.ports.apply('plan', {
    type: 'replace_plan',
    steps: [{
      id: 'work',
      title: 'Keep working',
      dependsOn: [],
      acceptanceCriteria: ['The work is complete.'],
      requiresVerification: false,
    }],
  })
  const tools = {
    read_file: tool({
      description: 'read',
      inputSchema: z.object({}),
      execute: async () => 'ok',
    }),
  }
  model(index => index < 4
    ? [{ name: 'read_file', id: `read-${index}` }]
    : index === 4
      ? [{ name: 'harness_update_step', id: 'finish-plan', input: { id: 'work', status: 'done', evidenceRefs: ['tool:read-3'] } }]
      : 'done')
  const result = await fixture.run(tools)
  expect(result.snapshot.status).toBe('completed')
  expect(fixture.calls.filter(call => call.kind === 'model').length).toBeGreaterThan(2)
})
