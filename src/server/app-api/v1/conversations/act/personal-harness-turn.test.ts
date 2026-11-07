import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import type { AgentRun } from '@/shared/agents/agent-run'
import type { UIMessage } from '@/server/ai/sdk'
import type { AuthenticatedAppUser } from '@/server/auth/app-api-auth'
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
  mocks.createUIMessageStreamResponse.mockImplementation(({ stream }) => new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = stream.getReader()
        const encoder = new TextEncoder()
        while (true) {
          const next = await reader.read()
          if (next.done) break
          controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`))
        }
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  ))
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
  expect(workflowInput.settings).toEqual({ maxOutputTokens: 8_192, reasoning: 'high' })
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

test('versioned accepted responses stream persisted text, source metadata, and terminal state', async () => {
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
  mocks.readPublicStreamState.mockResolvedValue({
    status: 'completed',
    workflowRunId: 'workflow',
    executionGeneration: 2,
    transcriptSteps: [{
      sequence: 0,
      executionGeneration: 2,
      receiptId: 'model:0',
      persistence: {
        content: 'Persisted answer.',
        parts: [{ type: 'tool-invocation', toolInvocation: { toolName: 'read_file', state: 'output-available' } }],
      },
    }],
    nextSequence: null,
    snapshot: null,
  })
  mocks.createUIMessageStreamResponse.mockImplementation(({ stream }) => new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = stream.getReader()
        const encoder = new TextEncoder()
        while (true) {
          const next = await reader.read()
          if (next.done) break
          controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`))
        }
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  ))

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
  const chunks = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)

  expect(response.status).toBe(200)
  expect(mocks.readPublicStreamState).toHaveBeenCalledWith({
    actorUserId: 'user', runId: 'personal:run-chat', afterSequence: -1,
  })
  expect(chunks).toContainEqual(expect.objectContaining({
    type: 'text-delta', delta: 'Persisted answer.',
  }))
  expect(chunks).toContainEqual(expect.objectContaining({
    type: 'data-harness-transcript-step',
    data: expect.objectContaining({
      receiptId: 'model:0',
      parts: [{ type: 'tool-invocation', toolInvocation: { toolName: 'read_file', state: 'output-available' } }],
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
        runId: 'personal:run-chat', executionGeneration: 2, status: 'completed',
      },
      sourceCitations,
    },
  })
})
