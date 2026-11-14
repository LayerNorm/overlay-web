import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { createUIMessageStreamResponse as sdkCreateUIMessageStreamResponse, parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema } from 'ai'
import { Chat } from '@ai-sdk/react'
import { buildAssistantVisualSequence } from '@overlay/chat-core'
import { buildGeneratedUiPart } from '@overlay/chat-core/generated-ui'
import type { AgentRun } from '@/shared/agents/agent-run'
import { buildAssistantPersistenceFromSteps } from '@/shared/chat/persist-assistant-turn'
import { publicHarnessStepPersistence } from '@/server/harness/harness-transcript'
import { executeRenderUi } from '@/server/tools/tools/overlay-executes'
import type { UIMessage, UIMessageChunk } from '@/server/ai/sdk'
import type { AuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { removeTransientGeneratedUiPreviews } from '@/features/chat/components/chat/generated-ui-mutation'
import { ActConversationRequest } from '@/shared/schemas/chat'
import {
  isPersonalHarnessRouteEligible,
  personalHarnessConversationClientId,
  startPersonalHarnessTurn,
} from './personal-harness-turn'
import { actRoutePolicyResponse, decidePersonalActRoute } from './act-route-policy'

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  convertToModelMessages: vi.fn(),
  createUIMessageStreamResponse: vi.fn(),
  drainWorkProgress: vi.fn(),
  describeTools: vi.fn(),
  readPublicStreamState: vi.fn(),
  startPersonalHarness: vi.fn(),
  uploadFilePartsForModel: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({
  after: mocks.after,
  NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) },
}))
vi.mock('@ai-sdk/workflow', () => ({
  createModelCallToUIChunkTransform: () => new TransformStream(),
}))
vi.mock('@/server/ai/sdk', () => ({
  convertToModelMessages: mocks.convertToModelMessages,
  createUIMessageStreamResponse: mocks.createUIMessageStreamResponse,
}))
vi.mock('@/server/ai/file-upload', () => ({ uploadFilePartsForModel: mocks.uploadFilePartsForModel }))
vi.mock('@/server/chat/work-progress-drain', () => ({ drainWorkProgress: mocks.drainWorkProgress }))
vi.mock('@/server/conversations/personal-chat-work-tools', () => ({ describePersonalChatWorkTools: mocks.describeTools }))
vi.mock('@/server/harness/ConvexHarnessRepository', () => ({
  ConvexHarnessRepository: class {
    readPublicStreamState = mocks.readPublicStreamState
  },
}))
vi.mock('@/server/harness/personal-admission', () => {
  class PersonalHarnessAdmissionConflict extends Error {}
  class PersonalHarnessStartPending extends Error {}
  return {
    PersonalHarnessAdmissionConflict,
    PersonalHarnessStartPending,
    personalHarnessAuthentication: (auth: AuthenticatedAppUser) => auth.authType === 'api-key'
      ? { type: 'api-key', apiKeyId: auth.apiKeyId }
      : { type: auth.authType },
    startPersonalHarness: mocks.startPersonalHarness,
  }
})

afterEach(() => vi.resetAllMocks())

function makeAgentRun(): AgentRun {
  return {
    id: 'run-chat',
    conversationId: 'conversation',
    turnId: 'turn-chat',
    userId: 'user',
    userMessageId: 'user-message-chat',
    assistantMessageId: 'assistant-message-chat',
    mode: 'chat',
    runner: 'workflow',
    executionEngine: 'overlay_harness',
    status: 'queued',
    createdAt: 1,
    updatedAt: 1,
  } as AgentRun
}

function modelStream() {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'start' })
      controller.enqueue({ type: 'text-delta', delta: 'Completed.' })
      controller.enqueue({ type: 'finish' })
      controller.close()
    },
  })
}

function acceptedTurnInput(): Parameters<typeof startPersonalHarnessTurn>[0] {
  return {
    agentRun: makeAgentRun(),
    auth: { userId: 'user', authType: 'session', accessToken: 'private-token' } as AuthenticatedAppUser,
    conversationId: 'conversation',
    emitWebhook: true,
    effectiveModelId: 'candidate-0',
    goal: 'Show the result.',
    hasDynamicApproval: false,
    instructions: 'Answer the request.',
    messagesForModel: [{ id: 'user-message', role: 'user', parts: [{ type: 'text', text: 'Show the result.' }] }] as UIMessage[],
    paid: true,
    principalId: 'principal',
    rawReasoning: 'low',
    requestId: 'request-live-preview',
    releaseConcurrency: vi.fn(),
    recordProgress: vi.fn(async () => {}),
    sourceCitations: {},
    tools: { render_ui: {} } as never,
    toolingContext: {
      accountAllowedConnectorIds: [],
      accountAllowedToolIds: ['render_ui'],
      baseUrl: 'https://internal.example',
      billingProgrammaticSubjectId: 'billing-subject',
      conversationId: 'conversation',
      effectiveModelId: 'candidate-0',
      latestUserText: 'Show the result.',
      mediaToolIntent: 'none',
      memoryEnabled: false,
      mode: 'chat',
      requestFingerprint: 'request-fingerprint',
      requestedToolIds: ['render_ui'],
      turnId: 'turn-chat',
      userId: 'user',
      workspaceId: 'workspace',
    },
    workspaceId: 'workspace',
  }
}

test('the route selector admits only authenticated personal requests, including Automate configuration chats', () => {
  for (const authType of ['session', 'access-token', 'api-key'] as const) {
    expect(isPersonalHarnessRouteEligible({ authType })).toBe(true)
    expect(isPersonalHarnessRouteEligible({ authType, automationMode: true })).toBe(false)
    expect(isPersonalHarnessRouteEligible({ authType, automationExecution: true })).toBe(false)
  }
  expect(isPersonalHarnessRouteEligible({ authType: 'service' })).toBe(false)
  expect(isPersonalHarnessRouteEligible({ authType: 'session' })).toBe(true)
})

test('legacy personalChatMode values are accepted but ignored by orchestration', () => {
  expect(ActConversationRequest.safeParse({ messages: [] }).success).toBe(true)
  for (const personalChatMode of ['chat', 'work'] as const) {
    expect(ActConversationRequest.safeParse({ messages: [], personalChatMode }).success).toBe(true)
  }
  const route = readFileSync(new URL('./ActTurnOrchestrationService.ts', import.meta.url), 'utf8')
  expect(route).not.toContain('personalChatMode')
})

test('personal Act cutover admits only the native Harness route', () => {
  const route = readFileSync(new URL('./ActTurnOrchestrationService.ts', import.meta.url), 'utf8')
  expect(route).toContain('startPersonalHarnessTurn({')
  expect(route).toContain('startPersonalWorkflow({')
  expect(route).toContain("computerApprovalContext: 'work'")
  expect(route).not.toContain('useWorkRunner')
  expect(route).not.toContain('personalChatWorkWorkflow')
  expect(route).not.toContain('startLegacyPersonalWorkflow')
  expect(route).not.toContain('agentRunService.startChat')
  expect(route).not.toContain('agentRunService.attachWorkflow')
  expect(route).not.toContain('actUsageBudgetService.reserveForAttempt')
  expect(route).not.toContain('actUsageBudgetService.recordFinishedUsage')
})

test('personal Act policy rejects retired execution and fails closed on Harness readiness', () => {
  expect(decidePersonalActRoute({ authType: 'service' })).toEqual({ kind: 'legacy_execution_retired' })
  expect(decidePersonalActRoute({ authType: 'session', automationExecution: true })).toEqual({ kind: 'legacy_execution_retired' })
  expect(decidePersonalActRoute({ authType: 'session', automationMode: true })).toEqual({ kind: 'legacy_execution_retired' })
  expect(decidePersonalActRoute({ authType: 'session', harnessReady: false })).toEqual({ kind: 'harness_unavailable' })
  expect(decidePersonalActRoute({ authType: 'session', harnessReady: true })).toEqual({ kind: 'admit' })
  expect(decidePersonalActRoute({ authType: 'session', mode: 'automate' })).toEqual({ kind: 'admit' })
  expect(decidePersonalActRoute({ authType: 'session' })).toEqual({ kind: 'admit' })
})

test('personal Act policy responses include truthful status, code, message, and request ID', async () => {
  const retired = actRoutePolicyResponse('legacy_execution_retired', 'request-retired')
  expect(retired.status).toBe(410)
  await expect(retired.json()).resolves.toMatchObject({
    code: 'legacy_execution_retired',
    error: 'legacy_execution_retired',
    message: expect.stringContaining('supported durable automation or surface entry point'),
    requestId: 'request-retired',
  })

  const unavailable = actRoutePolicyResponse('harness_unavailable', 'request-unavailable')
  expect(unavailable.status).toBe(503)
  await expect(unavailable.json()).resolves.toMatchObject({
    code: 'harness_unavailable',
    error: 'harness_unavailable',
    requestId: 'request-unavailable',
  })
})

test('generated conversation IDs are bounded, stable, and workspace-specific', () => {
  const input = { actorUserId: 'user', workspaceId: 'workspace-a', turnId: 'turn' }
  const first = personalHarnessConversationClientId(input)
  expect(first).toBe(personalHarnessConversationClientId(input))
  expect(first).not.toBe(personalHarnessConversationClientId({ ...input, workspaceId: 'workspace-b' }))
  expect(first.length).toBeLessThanOrEqual(48)
})

test('streams admitted multimodal history through the durable adapter', async () => {
  const run = makeAgentRun()
  const filePart = {
    type: 'file',
    mediaType: 'image/png',
    url: 'https://files.example/image.png',
    filename: 'image.png',
  }
  const messages = [{
    id: 'message-chat',
    role: 'user',
    parts: [{ type: 'text', text: 'Inspect this image.' }, filePart],
  }] as UIMessage[]
  const sourceCitations = { source: { kind: 'file', sourceId: 'file-1' } } as const
  const auth = { userId: 'user', authType: 'session', accessToken: 'private-token' } as AuthenticatedAppUser
  const releaseConcurrency = vi.fn()
  const recordProgress = vi.fn(async () => {})
  mocks.describeTools.mockResolvedValue([{ name: 'read_file' }])
  mocks.uploadFilePartsForModel.mockImplementation(async (uploadedMessages: UIMessage[], modelId: string) => {
    expect(uploadedMessages).toBe(messages)
    expect(modelId).toBe('candidate-0')
    const part = uploadedMessages[0]?.parts?.find(item => item.type === 'file')
    if (part) Object.assign(part, { providerReference: { gateway: 'file-ref' } })
  })
  mocks.convertToModelMessages.mockImplementation(async (uploadedMessages: UIMessage[]) => [{
    role: 'user',
    content: [{ type: 'image', image: uploadedMessages[0]?.parts?.find(item => item.type === 'file')?.url }],
  }])
  mocks.createUIMessageStreamResponse.mockImplementation(({ stream }) =>
    sdkCreateUIMessageStreamResponse({ stream }))
  mocks.startPersonalHarness.mockImplementation(async options => {
    await options.onAdmitted?.()
    return { getReadable: () => modelStream() }
  })

  const response = await startPersonalHarnessTurn({
    agentRun: run,
    auth,
    conversationId: 'conversation',
    emitWebhook: true,
    effectiveModelId: 'candidate-0',
    goal: 'Inspect this image.',
    hasDynamicApproval: true,
    instructions: 'Use the image and tools.',
    messagesForModel: messages,
    paid: true,
    principalId: 'principal',
    rawReasoning: 'high',
    requestId: 'request-1',
    releaseConcurrency,
    recordProgress,
    sourceCitations,
    tools: { read_file: {} } as never,
    toolingContext: {
      accountAllowedConnectorIds: ['connector-1'],
      accountAllowedToolIds: ['read_file'],
      baseUrl: 'https://internal.example',
      billingProgrammaticSubjectId: 'billing-subject',
      conversationId: 'conversation',
      effectiveModelId: 'candidate-0',
      latestUserText: 'Inspect this image.',
      mediaToolIntent: 'image',
      memoryEnabled: false,
      mode: 'chat',
      requestFingerprint: 'request-fingerprint',
      requestedToolIds: ['read_file'],
      turnId: 'turn-chat',
      userId: 'user',
      workspaceId: 'workspace',
    },
    workspaceId: 'workspace',
  })
  const body = await response.text()
  const workflowInput = mocks.startPersonalHarness.mock.calls[0]![0].workflow

  expect(response.status).toBe(200)
  expect(response.headers.get('x-request-id')).toBe('request-1')
  expect(response.headers.get('x-overlay-agent-run-id')).toBe(run.id)
  expect(response.headers.get('x-overlay-conversation-id')).toBe('conversation')
  expect(workflowInput.access.runId).toBe(`personal:${run.id}`)
  expect(workflowInput.messages[0]?.content).toEqual([{ type: 'image', image: 'https://files.example/image.png' }])
  expect(messages[0]?.parts?.find(part => part.type === 'file')).toMatchObject({
    url: 'https://files.example/image.png',
    providerReference: { gateway: 'file-ref' },
  })
  expect(workflowInput.context.mode).toBe('chat')
  expect(workflowInput.context.mediaToolIntent).toBe('image')
  expect(workflowInput.definitions).toEqual([{ name: 'read_file' }])
  expect(workflowInput.delivery).toEqual({ emitWebhook: true, sourceCitations })
  expect(workflowInput.settings).toEqual({ maxOutputTokens: 32_000, reasoning: 'high' })
  expect(workflowInput.context).toMatchObject({
    accountAllowedConnectorIds: ['connector-1'],
    accountAllowedToolIds: ['read_file'],
    billingProgrammaticSubjectId: 'billing-subject',
    requestFingerprint: 'request-fingerprint',
    requestedToolIds: ['read_file'],
    turnId: 'turn-chat',
    workspaceId: 'workspace',
  })
  expect(workflowInput.access.authentication).toEqual({ type: 'session' })
  expect(workflowInput.context).not.toHaveProperty('accessToken')
  expect(workflowInput.context).not.toHaveProperty('serverSecret')
  expect(workflowInput.context).not.toHaveProperty('cookie')
  expect(workflowInput.context).not.toHaveProperty('paid')
  expect(workflowInput.context).not.toHaveProperty('entitlements')
  expect(JSON.stringify(workflowInput)).not.toContain('private-token')
  expect(body).toContain('sourceCitations')
  expect(releaseConcurrency).toHaveBeenCalledOnce()
  expect(mocks.after).toHaveBeenCalledOnce()
})

test('versioned accepted responses clear abandoned previews when cancelled', async () => {
  const run = makeAgentRun()
  const sourceCitations = { source: { kind: 'file', sourceId: 'file-1' } } as const
  const auth = { userId: 'user', authType: 'session', accessToken: 'private-token' } as AuthenticatedAppUser
  mocks.describeTools.mockResolvedValue([{ name: 'read_file' }])
  mocks.uploadFilePartsForModel.mockImplementation(async (messages: UIMessage[]) => messages)
  mocks.convertToModelMessages.mockResolvedValue([{ role: 'user', content: 'Show the result.' }])
  mocks.startPersonalHarness.mockImplementation(async options => {
    await options.onAdmitted?.()
    return { accepted: true, runId: 'personal:run-chat', executionGeneration: 2 }
  })
  const transcriptSteps = Array.from({ length: 12 }, (_, sequence) => ({
    sequence,
    executionGeneration: 2,
    receiptId: `model:${sequence}`,
    persistence: {
      content: 'Persisted answer.',
      parts: sequence === 0
        ? [{ type: 'tool-invocation', toolInvocation: { toolCallId: 'call-1', toolName: 'read_file', toolInput: {}, toolOutput: 'file', state: 'output-available' } }]
        : [],
    },
  }))
  let readCount = 0
  mocks.readPublicStreamState.mockImplementation(async ({ afterSequence }: { afterSequence: number }) => {
    readCount++
    if (readCount === 1) return {
      status: 'running', workflowRunId: 'workflow', executionGeneration: 2, transcriptSteps: [],
      nextSequence: null,
      snapshot: { runId: 'personal:run-chat', executionGeneration: 2, receiptId: 'model:0', invocation: 0,
        sequence: 0, text: 'Before after', assistantMessageId: 'assistant', previews: [{
          toolCallId: 'render-1', order: 0, sequence: 0, textOffset: 7,
          data: { version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Building view', streaming: true,
            specJson: '{"root":"view","elements":{"view":{"type":"Stack","props":{},"children":[]}}}' },
        }] },
    }
    const page = transcriptSteps.filter(step => step.sequence > afterSequence).slice(0, 10)
    return {
      status: page.at(-1)?.sequence === 11 ? 'cancelled' : 'running',
      workflowRunId: 'workflow', executionGeneration: 2, transcriptSteps: page,
      nextSequence: page.length === 10 ? page.at(-1)!.sequence : null,
      snapshot: null,
    }
  })
  mocks.createUIMessageStreamResponse.mockImplementation(({ stream }) =>
    sdkCreateUIMessageStreamResponse({ stream }))

  const response = await startPersonalHarnessTurn({
    agentRun: run,
    auth,
    conversationId: 'conversation',
    emitWebhook: true,
    effectiveModelId: 'candidate-0',
    goal: 'Show the result.',
    hasDynamicApproval: false,
    instructions: 'Answer the request.',
    messagesForModel: [{ id: 'user-message', role: 'user', parts: [{ type: 'text', text: 'Show the result.' }] }] as UIMessage[],
    paid: true,
    principalId: 'principal',
    rawReasoning: 'low',
    requestId: 'request-accepted',
    releaseConcurrency: vi.fn(),
    recordProgress: vi.fn(async () => {}),
    sourceCitations,
    tools: { read_file: {} } as never,
    toolingContext: {
      accountAllowedConnectorIds: [],
      accountAllowedToolIds: ['read_file'],
      baseUrl: 'https://internal.example',
      billingProgrammaticSubjectId: 'billing-subject',
      conversationId: 'conversation',
      effectiveModelId: 'candidate-0',
      latestUserText: 'Show the result.',
      mediaToolIntent: 'none',
      memoryEnabled: false,
      mode: 'chat',
      requestFingerprint: 'request-fingerprint',
      requestedToolIds: ['read_file'],
      turnId: 'turn-chat',
      userId: 'user',
      workspaceId: 'workspace',
    },
    workspaceId: 'workspace',
  })
  const parsedReader = parseJsonEventStream({ stream: response.body!, schema: uiMessageChunkSchema }).getReader()
  const chunks: UIMessageChunk[] = []
  while (true) {
    const next = await parsedReader.read()
    if (next.done) break
    if (!next.value.success) throw next.value.error
    chunks.push(next.value.value)
  }
  const uiStream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  const reconstructed: UIMessage[] = []
  for await (const message of readUIMessageStream({ stream: uiStream })) reconstructed.push(message)

  expect(response.status).toBe(200)
  expect(mocks.readPublicStreamState).toHaveBeenCalledWith({
    actorUserId: 'user', runId: 'personal:run-chat', afterSequence: -1,
  })
  expect(mocks.readPublicStreamState).toHaveBeenCalledTimes(3)
  expect(chunks).toContainEqual(expect.objectContaining({
    type: 'text-delta', delta: 'Persisted answer.',
  }))
  expect(chunks).toContainEqual(expect.objectContaining({
    type: 'data-overlay.generated_ui', id: 'render-1',
    data: expect.objectContaining({ kind: 'json_render', summary: 'Building view', streaming: true }),
  }))
  const beforeIndex = chunks.findIndex(chunk => chunk.type === 'text-delta' && chunk.delta === 'Before ')
  const previewIndex = chunks.findIndex(chunk => chunk.type === 'data-overlay.generated_ui' && chunk.id === 'render-1')
  const afterIndex = chunks.findIndex(chunk => chunk.type === 'text-delta' && chunk.delta === 'after')
  expect(beforeIndex).toBeGreaterThanOrEqual(0)
  expect(beforeIndex).toBeLessThan(previewIndex)
  expect(previewIndex).toBeLessThan(afterIndex)
  expect(chunks).toContainEqual(expect.objectContaining({
    type: 'data-overlay.generated_ui', id: 'render-1', data: { kind: 'preview-cleared' },
  }))
  expect(chunks).toContainEqual(expect.objectContaining({
    type: 'data-harness-transcript-step',
    data: expect.objectContaining({
      receiptId: 'model:0',
      parts: expect.arrayContaining([expect.objectContaining({
        type: 'tool-invocation',
        toolInvocation: expect.objectContaining({ toolName: 'read_file', state: 'output-available' }),
      })]),
    }),
  }))
  expect(chunks).toContainEqual(expect.objectContaining({
    type: 'message-metadata',
    messageMetadata: expect.objectContaining({ harnessAccepted: expect.objectContaining({ status: 'running' }) }),
  }))
  expect(chunks.at(-1)).toMatchObject({
    type: 'finish',
    messageMetadata: {
      harnessAccepted: {
        runId: 'personal:run-chat', executionGeneration: 2, status: 'cancelled',
      },
      sourceCitations,
    },
  })
  expect(reconstructed.at(-1)?.parts.some(part => part.type === 'text')).toBe(true)
  const reconstructedText = reconstructed.at(-1)?.parts
    .filter(part => part.type === 'text').map(part => part.text).join('') ?? ''
  expect(reconstructedText).not.toContain('Provisional text')
  expect(chunks.filter(chunk => chunk.type === 'data-harness-transcript-step')).toHaveLength(12)
  expect(chunks.findIndex(chunk => chunk.type === 'tool-input-available'))
    .toBeLessThan(chunks.findIndex(chunk => chunk.type === 'tool-output-available'))
})

test('personal SSE keeps a preview visible through SDK success replacement and clears failed previews', async () => {
  mocks.describeTools.mockResolvedValue([{ name: 'render_ui' }])
  mocks.uploadFilePartsForModel.mockImplementation(async (messages: UIMessage[]) => messages)
  mocks.convertToModelMessages.mockResolvedValue([{ role: 'user', content: 'Show the result.' }])
  mocks.startPersonalHarness.mockResolvedValue({ accepted: true, runId: 'personal:run-chat', executionGeneration: 2 })
  mocks.createUIMessageStreamResponse.mockImplementation(({ stream }) => sdkCreateUIMessageStreamResponse({ stream }))

  const preview = {
    version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Building view', streaming: true,
    specJson: '{"root":"root","elements":{"root":{"type":"Text","props":{"text":"Preview"}}}}',
  }
  const successInput = { summary: 'Finished view', spec: { root: 'root', elements: {
    root: { type: 'Text', props: { text: 'Finished' } },
  } } }
  const successOutput = await executeRenderUi({ userId: 'user', serverSecret: 'secret', baseUrl: 'http://localhost:3000' }, successInput)
  expect(successOutput.success).toBe(true)
  if (!successOutput.success) throw new Error('Expected render_ui success')
  const failedInput = { summary: 'Invalid view', spec: { root: 'root', elements: {} } }
  const failureResult = await executeRenderUi({ userId: 'user', serverSecret: 'secret', baseUrl: 'http://localhost:3000' }, failedInput)
  expect(failureResult.success).toBe(false)
  if (failureResult.success) throw new Error('Expected render_ui validation failure')
  const successCall = { type: 'tool-call', toolCallId: 'render-1', toolName: 'render_ui', input: successInput }
  const failedCall = { type: 'tool-call', toolCallId: 'render-failed', toolName: 'render_ui', input: failedInput }
  const persisted = publicHarnessStepPersistence({
    text: 'Before after',
    finishReason: 'stop',
    content: [
      { type: 'text', text: 'Before ' },
      successCall,
      { type: 'tool-result', ...successCall, output: successOutput },
      { type: 'text', text: 'after' },
      failedCall,
      { type: 'tool-result', ...failedCall, output: failureResult },
    ],
    toolCalls: [successCall, failedCall],
    toolResults: [
      { ...successCall, output: successOutput },
      { ...failedCall, output: failureResult },
    ],
  } as never, new Set(['render_ui']))
  const savedFinalPart = persisted.parts.find(part => part.type === 'data' && part.dataType === 'overlay.generated_ui')
  expect(successOutput.id).not.toBe('render-1')
  expect(savedFinalPart?.id).toBe('render-1')
  const finalStep = {
    sequence: 0,
    executionGeneration: 2,
    receiptId: 'model:0',
    persistence: persisted,
  }
  let readCount = 0
  mocks.readPublicStreamState.mockImplementation(async () => {
    readCount++
    if (readCount === 1) return {
      status: 'running', workflowRunId: 'workflow', executionGeneration: 2, transcriptSteps: [],
      nextSequence: null,
      snapshot: { runId: 'personal:run-chat', executionGeneration: 2, receiptId: 'model:0', invocation: 0,
        sequence: 0, text: 'Before af', assistantMessageId: 'assistant', previews: [
          { toolCallId: 'render-1', order: 0, sequence: 0, textOffset: 7, data: preview },
          { toolCallId: 'render-failed', order: 1, sequence: 0, textOffset: 7, data: { ...preview, summary: 'Invalid view' } },
        ] },
    }
    return {
      status: 'completed', workflowRunId: 'workflow', executionGeneration: 2,
      transcriptSteps: [finalStep], nextSequence: null, snapshot: null,
    }
  })

  const response = await startPersonalHarnessTurn(acceptedTurnInput())
  const parsedReader = parseJsonEventStream({ stream: response.body!, schema: uiMessageChunkSchema }).getReader()
  const chunks: UIMessageChunk[] = []
  while (true) {
    const next = await parsedReader.read()
    if (next.done) break
    if (!next.value.success) throw next.value.error
    chunks.push(next.value.value)
  }

  const snapshots: UIMessage[][] = []
  const chatRef: { current?: Chat<UIMessage> } = {}
  const chat = new Chat({
    id: 'personal-preview-replacement',
    transport: {
      sendMessages: async () => new ReadableStream<UIMessageChunk>({
        start(controller) {
          chunks.forEach(chunk => controller.enqueue(chunk))
          controller.close()
        },
      }),
      reconnectToStream: async () => null,
    } as never,
    onFinish: ({ messages }) => {
      const settled = removeTransientGeneratedUiPreviews(messages as UIMessage[])
      if (settled !== messages && chatRef.current) chatRef.current.messages = settled as never
    },
  })
  chatRef.current = chat
  const unsubscribe = chat['~registerMessagesCallback'](() => {
    snapshots.push(JSON.parse(JSON.stringify(chat.messages)) as UIMessage[])
  })
  await chat.sendMessage({ text: 'Show the result.' })
  unsubscribe()

  const assistantParts = (messages: UIMessage[]) => [...messages].reverse().find(message => message.role === 'assistant')?.parts ?? []
  const visuals = snapshots.map(messages => buildAssistantVisualSequence(assistantParts(messages)))
  const previewSnapshot = snapshots.findIndex(messages => assistantParts(messages).some(part =>
    part.type === 'data-overlay.generated_ui' && part.id === 'render-1'
      && (part.data as Record<string, unknown>).streaming === true))
  const successSnapshot = snapshots.findIndex(messages => assistantParts(messages).some(part => {
    const generated = part as { type?: string; id?: string; data?: { summary?: string; streaming?: boolean } }
    return generated.type === 'data-overlay.generated_ui' && generated.id === 'render-1'
      && generated.data?.summary === 'Finished view' && generated.data.streaming !== true
  }))
  expect(previewSnapshot).toBeGreaterThanOrEqual(0)
  expect(successSnapshot).toBeGreaterThan(previewSnapshot)
  for (let index = previewSnapshot; index <= successSnapshot; index++) {
    const partSummary = assistantParts(snapshots[index] ?? []).map(part => {
      const value = part as { type?: string; id?: string; toolCallId?: string; state?: string;
        data?: { kind?: string; streaming?: boolean }; output?: { success?: boolean } }
      return [value.type, value.id, value.toolCallId, value.state, value.data?.kind, value.data?.streaming, value.output?.success].join(':')
    }).join(',')
    expect(visuals[index]?.some(block => block.kind === 'generated-ui' && block.part.id === 'render-1'),
      `snapshot ${index}: ${visuals[index]?.map(block => block.kind === 'generated-ui' ? block.part.id : block.kind).join(',')} [${partSummary}]`)
      .toBe(true)
  }
  expect(visuals[successSnapshot]?.find(block => block.kind === 'generated-ui' && block.part.id === 'render-1')?.part.data.summary)
    .toBe('Finished view')

  const finalDataIndex = chunks.findIndex(chunk => chunk.type === 'data-overlay.generated_ui'
    && chunk.id === 'render-1' && (chunk.data as Record<string, unknown>).summary === 'Finished view')
  const transcriptStepIndex = chunks.findIndex(chunk => chunk.type === 'data-harness-transcript-step')
  expect(finalDataIndex).toBeGreaterThanOrEqual(0)
  expect(finalDataIndex).toBeLessThan(transcriptStepIndex)
  expect(chunks.some(chunk => chunk.type === 'tool-output-available' && chunk.toolCallId === 'render-1')).toBe(false)

  const failedClear = chunks.findIndex(chunk => chunk.type === 'data-overlay.generated_ui'
    && chunk.id === 'render-failed' && (chunk.data as Record<string, unknown>).kind === 'preview-cleared')
  const failedOutput = chunks.findIndex(chunk => chunk.type === 'tool-output-error' && chunk.toolCallId === 'render-failed')
  expect(failedClear).toBeGreaterThanOrEqual(0)
  expect(failedClear).toBeLessThan(failedOutput)
  expect(chunks.some(chunk => chunk.type === 'data-overlay.generated_ui'
    && chunk.id === 'render-1' && (chunk.data as Record<string, unknown>).kind === 'preview-cleared')).toBe(false)
  const finalParts = assistantParts(chat.messages as UIMessage[])
  const streamedFinalPart = finalParts.find(part => part.type === 'data-overlay.generated_ui' && part.id === 'render-1')
  expect(streamedFinalPart && (streamedFinalPart.data as Record<string, unknown>).summary).toBe('Finished view')
  expect(streamedFinalPart?.id).toBe(savedFinalPart?.id)
  const reconciledVisuals = buildAssistantVisualSequence([...finalParts, savedFinalPart!])
  expect(reconciledVisuals.filter(block => block.kind === 'generated-ui').map(block => block.kind === 'generated-ui' ? block.part.id : ''))
    .toEqual(['render-1'])
  expect(finalParts.filter(part => part.type === 'text').map(part => part.text).join('')).toBe('Before after')
  expect(finalParts.some(part => part.type === 'data-overlay.generated_ui' && (part.data as Record<string, unknown>).streaming === true)).toBe(false)
  const orderedSdkContent = finalParts.flatMap(part => {
    if (part.type === 'text' && part.text) return [{ kind: 'text', text: part.text }]
    if (part.type === 'data-overlay.generated_ui' && part.id === 'render-1'
      && (part.data as Record<string, unknown>).summary === 'Finished view') return [{ kind: 'generated-ui' }]
    return []
  })
  expect(orderedSdkContent).toEqual([
    { kind: 'text', text: 'Before ' },
    { kind: 'generated-ui' },
    { kind: 'text', text: 'after' },
  ])
  const orderedFinalContent = buildAssistantVisualSequence(finalParts).flatMap(block => {
    if (block.kind === 'text') return [block.text]
    if (block.kind === 'generated-ui' && block.part.id === 'render-1') return ['<generated-ui>']
    return []
  })
  expect(orderedFinalContent).toEqual(['Before', '<generated-ui>', 'after'])
})

test('personal SSE delivers legacy standalone generated UI IDs without previews', async () => {
  mocks.describeTools.mockResolvedValue([{ name: 'render_ui' }])
  mocks.uploadFilePartsForModel.mockImplementation(async (messages: UIMessage[]) => messages)
  mocks.convertToModelMessages.mockResolvedValue([{ role: 'user', content: 'Show the result.' }])
  mocks.startPersonalHarness.mockResolvedValue({ accepted: true, runId: 'personal:run-chat', executionGeneration: 2 })
  mocks.createUIMessageStreamResponse.mockImplementation(({ stream }) => sdkCreateUIMessageStreamResponse({ stream }))

  const legacyPart = buildGeneratedUiPart('legacy-content-hash', {
    version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Legacy view',
    specJson: '{"root":"root","elements":{"root":{"type":"Text","props":{"text":"Saved"}}}}',
  })
  expect(legacyPart).not.toBeNull()
  const transcriptStep = {
    sequence: 0, executionGeneration: 2, receiptId: 'model:0',
    persistence: { content: '', parts: legacyPart ? [legacyPart] : [] },
  }
  mocks.readPublicStreamState.mockResolvedValue({
    status: 'completed', workflowRunId: 'workflow', executionGeneration: 2,
    transcriptSteps: [transcriptStep], nextSequence: null, snapshot: null,
  })

  const response = await startPersonalHarnessTurn(acceptedTurnInput())
  const reader = parseJsonEventStream({ stream: response.body!, schema: uiMessageChunkSchema }).getReader()
  const chunks: UIMessageChunk[] = []
  while (true) {
    const next = await reader.read()
    if (next.done) break
    if (!next.value.success) throw next.value.error
    chunks.push(next.value.value)
  }

  const finalParts = chunks.filter(chunk => chunk.type === 'data-overlay.generated_ui' && chunk.id === 'legacy-content-hash')
  expect(finalParts).toHaveLength(1)
  expect((finalParts[0]?.data as Record<string, unknown>).summary).toBe('Legacy view')
  expect((finalParts[0]?.data as Record<string, unknown>).streaming).not.toBe(true)
})

test('personal SSE emits a committed generated UI transcript step before a cancelled finish', async () => {
  mocks.describeTools.mockResolvedValue([{ name: 'render_ui' }])
  mocks.uploadFilePartsForModel.mockImplementation(async (messages: UIMessage[]) => messages)
  mocks.convertToModelMessages.mockResolvedValue([{ role: 'user', content: 'Show the result.' }])
  mocks.startPersonalHarness.mockResolvedValue({ accepted: true, runId: 'personal:run-chat', executionGeneration: 2 })
  mocks.createUIMessageStreamResponse.mockImplementation(({ stream }) => sdkCreateUIMessageStreamResponse({ stream }))

  const committedPart = buildGeneratedUiPart('view-before-stop', {
    version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Completed before Stop',
    specJson: '{"root":"root","elements":{"root":{"type":"Text","props":{"text":"Committed"}}}}',
  })
  expect(committedPart).not.toBeNull()
  mocks.readPublicStreamState.mockResolvedValue({
    status: 'cancelled', workflowRunId: 'workflow', executionGeneration: 2,
    transcriptSteps: [{ sequence: 0, executionGeneration: 2, receiptId: 'model:0',
      persistence: { content: '', parts: committedPart ? [committedPart] : [] } }],
    nextSequence: null, snapshot: null,
  })

  const response = await startPersonalHarnessTurn(acceptedTurnInput())
  const reader = parseJsonEventStream({ stream: response.body!, schema: uiMessageChunkSchema }).getReader()
  const chunks: UIMessageChunk[] = []
  while (true) {
    const next = await reader.read()
    if (next.done) break
    if (!next.value.success) throw next.value.error
    chunks.push(next.value.value)
  }

  expect(chunks).toContainEqual(expect.objectContaining({
    type: 'data-overlay.generated_ui', id: 'view-before-stop',
    data: expect.objectContaining({ summary: 'Completed before Stop' }),
  }))
  expect(chunks.at(-1)).toMatchObject({
    type: 'finish',
    messageMetadata: { harnessAccepted: { status: 'cancelled' } },
  })
})

test('personal SSE ignores a transcript read that resolves after request abort', async () => {
  mocks.describeTools.mockResolvedValue([{ name: 'render_ui' }])
  mocks.uploadFilePartsForModel.mockImplementation(async (messages: UIMessage[]) => messages)
  mocks.convertToModelMessages.mockResolvedValue([{ role: 'user', content: 'Show the result.' }])
  mocks.startPersonalHarness.mockResolvedValue({ accepted: true, runId: 'personal:run-chat', executionGeneration: 2 })
  mocks.createUIMessageStreamResponse.mockImplementation(({ stream }) => sdkCreateUIMessageStreamResponse({ stream }))

  const latePart = buildGeneratedUiPart('view-after-abort', {
    version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Read after Stop',
    specJson: '{"root":"root","elements":{"root":{"type":"Text","props":{"text":"Late"}}}}',
  })
  expect(latePart).not.toBeNull()
  const cancelledState = {
    status: 'cancelled', workflowRunId: 'workflow', executionGeneration: 2,
    transcriptSteps: [{ sequence: 1, executionGeneration: 2, receiptId: 'model:1',
      persistence: { content: '', parts: latePart ? [latePart] : [] } }],
    nextSequence: null, snapshot: null,
  }
  let resolveRead!: (state: typeof cancelledState) => void
  const pendingRead = new Promise<typeof cancelledState>(resolve => { resolveRead = resolve })
  let markReadStarted!: () => void
  const readStarted = new Promise<void>(resolve => { markReadStarted = resolve })
  mocks.readPublicStreamState.mockImplementation(async () => {
    markReadStarted()
    return await pendingRead
  })

  const abort = new AbortController()
  const response = await startPersonalHarnessTurn({ ...acceptedTurnInput(), signal: abort.signal })
  const reader = parseJsonEventStream({ stream: response.body!, schema: uiMessageChunkSchema }).getReader()
  const chunks: UIMessageChunk[] = []
  const collect = (async () => {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (!next.value.success) throw next.value.error
      chunks.push(next.value.value)
    }
  })()

  await readStarted
  abort.abort()
  resolveRead(cancelledState)
  await collect

  expect(chunks.some(chunk => chunk.type === 'data-overlay.generated_ui' && chunk.id === 'view-after-abort')).toBe(false)
})

test('personal SSE preserves a preview when canonical persistence trims trailing whitespace', async () => {
  mocks.describeTools.mockResolvedValue([{ name: 'render_ui' }])
  mocks.uploadFilePartsForModel.mockImplementation(async (messages: UIMessage[]) => messages)
  mocks.convertToModelMessages.mockResolvedValue([{ role: 'user', content: 'Show the result.' }])
  mocks.startPersonalHarness.mockResolvedValue({ accepted: true, runId: 'personal:run-chat', executionGeneration: 2 })
  mocks.createUIMessageStreamResponse.mockImplementation(({ stream }) => sdkCreateUIMessageStreamResponse({ stream }))

  const canonical = buildAssistantPersistenceFromSteps([{
    text: 'Before after  ',
    finishReason: 'stop',
    content: [{ type: 'text', text: 'Before after  ' }],
    toolCalls: [],
    toolResults: [],
  } as never], '')
  expect(canonical.content).toBe('Before after')

  const generatedUi = {
    version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Finished view',
    specJson: '{"root":"root","elements":{"root":{"type":"Text","props":{"text":"Finished"}}}}',
  }
  const finalStep = {
    sequence: 0,
    executionGeneration: 2,
    receiptId: 'model:0',
    persistence: {
      ...canonical,
      parts: [...canonical.parts, { type: 'tool-invocation', toolInvocation: {
        toolCallId: 'render-1', toolName: 'render_ui', state: 'output-available',
        toolInput: { summary: 'Finished view', specStream: '' },
        toolOutput: { success: true, id: 'render-1', generatedUi },
      } }],
    },
  }
  let readCount = 0
  mocks.readPublicStreamState.mockImplementation(async () => {
    readCount++
    if (readCount === 1) return {
      status: 'running', workflowRunId: 'workflow', executionGeneration: 2, transcriptSteps: [],
      nextSequence: null,
      snapshot: { runId: 'personal:run-chat', executionGeneration: 2, receiptId: 'model:0', invocation: 0,
        sequence: 0, text: 'Before after  ', assistantMessageId: 'assistant', previews: [
          { toolCallId: 'render-1', order: 0, sequence: 0, textOffset: 7, data: {
            version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Building view', streaming: true,
            specJson: '{"root":"root","elements":{"root":{"type":"Text","props":{"text":"Preview"}}}}',
          } },
        ] },
    }
    return {
      status: 'completed', workflowRunId: 'workflow', executionGeneration: 2,
      transcriptSteps: [finalStep], nextSequence: null, snapshot: null,
    }
  })

  const response = await startPersonalHarnessTurn(acceptedTurnInput())
  const reader = parseJsonEventStream({ stream: response.body!, schema: uiMessageChunkSchema }).getReader()
  const chunks: UIMessageChunk[] = []
  while (true) {
    const next = await reader.read()
    if (next.done) break
    if (!next.value.success) throw next.value.error
    chunks.push(next.value.value)
  }

  expect(chunks.some(chunk => chunk.type === 'reset-step')).toBe(false)
  expect(chunks.some(chunk => chunk.type === 'data-overlay.generated_ui'
    && chunk.id === 'render-1' && (chunk.data as Record<string, unknown>).kind === 'preview-cleared')).toBe(false)
  const streamedText = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.delta).join('')
  expect(streamedText).toBe('Before after  ')
  expect(streamedText.trimEnd()).toBe(canonical.content)
  const finalDataIndex = chunks.findIndex(chunk => chunk.type === 'data-overlay.generated_ui'
    && chunk.id === 'render-1' && (chunk.data as Record<string, unknown>).summary === 'Finished view')
  const successOutputIndex = chunks.findIndex(chunk => chunk.type === 'tool-output-available' && chunk.toolCallId === 'render-1')
  expect(finalDataIndex).toBeGreaterThanOrEqual(0)
  expect(finalDataIndex).toBeLessThan(successOutputIndex)
})
