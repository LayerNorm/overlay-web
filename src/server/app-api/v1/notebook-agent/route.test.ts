import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { HarnessTranscriptPersistence } from '@overlay/agent-runtime/harness-store'
import { notebookRequestDigest } from '@/server/notebook/notebook-agent-identity'
import { compactTranscriptSnapshot } from '@/server/harness/transcript-snapshot'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  note: null as unknown,
  state: null as unknown,
  agentRun: null as unknown,
  conversation: null as unknown,
  checkCapability: vi.fn(),
  checkResolvedResourceAccess: vi.fn(),
  checkResolvedCatalogResourceAccess: vi.fn(),
  getResourceOwner: vi.fn(),
  resolveSubject: vi.fn(),
  apiKeyAllowed: vi.fn(),
  gateModelAccess: vi.fn(),
  getConversationById: vi.fn(),
  getLatestAgentRun: vi.fn(),
  getRecentMessages: vi.fn(),
  ensureActConversationId: vi.fn(),
  persistUserMessage: vi.fn(),
  startPersonalWorkflow: vi.fn(),
  startPersonalHarness: vi.fn(),
  repositoryGet: vi.fn(),
  readPublicStreamState: vi.fn(),
  describeNotebookTools: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@overlay/app-core', () => ({
  normalizeNotebookTitle: (value: string) => value.trim() || 'Untitled',
}))
vi.mock('@overlay/app-core/note-markdown', () => ({
  noteMarkdownToEditorText: (value: string) => value,
  toCanonicalNoteMarkdown: (value: string) => value,
}))
vi.mock('@/server/bootstrap', () => ({
  getOverlayServerContext: () => ({
    authorizationService: {
      checkCapability: mocks.checkCapability,
      checkResolvedResourceAccess: mocks.checkResolvedResourceAccess,
      checkResolvedCatalogResourceAccess: mocks.checkResolvedCatalogResourceAccess,
      getResourceOwner: mocks.getResourceOwner,
      resolveSubject: mocks.resolveSubject,
    },
  }),
}))
vi.mock('@/server/ai/model-policy-authority', () => ({
  resolveAuthorizedModelIds: vi.fn(async () => ({ chat: new Set(['test-model']) })),
}))
vi.mock('@/server/ai/model-runtime', () => ({
  assertUserCanUseByokModel: vi.fn(),
}))
vi.mock('@/server/shared/internal-api-secret', () => ({
  getInternalApiSecret: vi.fn(() => 'test-secret'),
}))
vi.mock('@/server/web/app-url', () => ({
  getInternalApiBaseUrl: vi.fn(() => 'https://example.test'),
}))
vi.mock('@/server/knowledge/mention-resolver', () => ({
  resolveMentionsContext: vi.fn(async () => ''),
}))
vi.mock('@/server/agent/notebook-agent-prompts', () => ({
  buildNotebookAgentInstructions: vi.fn(() => ''),
}))
vi.mock('@/server/notes', () => ({
  NoteService: class {
    async getNote() { return mocks.note }
  },
}))
vi.mock('@/server/notes/ConvexNoteRepository', () => ({
  ConvexNoteRepository: class {},
}))
vi.mock('@/server/conversations/ensure-act-conversation', () => ({
  ensureActConversationId: mocks.ensureActConversationId,
}))
vi.mock('@/server/conversations/http', () => ({
  actConversationRepository: {
    getConversationById: mocks.getConversationById,
    getLatestAgentRun: mocks.getLatestAgentRun,
    getRecentMessages: mocks.getRecentMessages,
  },
  actEntitlementService: { gateModelAccess: mocks.gateModelAccess },
  actMessagePersistenceService: { persistUserMessage: mocks.persistUserMessage },
  agentRunService: { startPersonalWorkflow: mocks.startPersonalWorkflow },
}))
vi.mock('@/server/harness/ConvexHarnessRepository', () => ({
  ConvexHarnessRepository: class {
    async get(value: unknown) { return mocks.repositoryGet(value) }
    async readPublicStreamState() { return mocks.readPublicStreamState() }
  },
}))
vi.mock('@/server/harness/personal-admission', () => ({
  PersonalHarnessAdmissionConflict: class extends Error {},
  PersonalHarnessStartPending: class extends Error {},
  personalHarnessAuthentication: vi.fn(() => ({ type: 'session' })),
  startPersonalHarness: mocks.startPersonalHarness,
}))
vi.mock('@/server/harness/personal-access', () => ({
  isApiKeyChatWriteAllowed: mocks.apiKeyAllowed,
}))
vi.mock('@/server/notebook/notebook-agent-tools', () => ({
  describeNotebookTools: mocks.describeNotebookTools,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.note = { title: 'Notes', content: 'source markdown' }
  const requestDigest = notebookRequestDigest({
    noteId: 'note-1',
    turnId: 'turn-1',
    noteMarkdown: 'source markdown',
    noteTitle: 'Notes',
    message: 'Continue the existing turn',
    modelId: 'test-model',
  })
  mocks.state = {
    runId: 'personal:agent-run-1',
    policy: {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      allowedToolIds: ['read_note', 'propose_edit', 'finish'],
      surface: { kind: 'notebook', noteId: 'note-1', turnId: 'turn-1', requestDigest },
    },
  }
  mocks.agentRun = {
    id: 'agent-run-1',
    conversationId: 'conversation-1',
    userId: 'user-1',
    turnId: 'turn-1',
  }
  mocks.conversation = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    conversationType: 'personal',
  }
  mocks.checkCapability.mockResolvedValue({ allowed: true })
  mocks.checkResolvedResourceAccess.mockResolvedValue({ allowed: true })
  mocks.checkResolvedCatalogResourceAccess.mockResolvedValue({ allowed: true })
  mocks.getResourceOwner.mockResolvedValue('user-1')
  mocks.resolveSubject.mockResolvedValue({ userId: 'user-1' })
  mocks.apiKeyAllowed.mockResolvedValue(true)
  mocks.gateModelAccess.mockResolvedValue({ paid: true, runtimeEntitlements: {} })
  mocks.getConversationById.mockResolvedValue(mocks.conversation)
  mocks.getLatestAgentRun.mockResolvedValue(mocks.agentRun)
  mocks.getRecentMessages.mockResolvedValue([])
  mocks.ensureActConversationId.mockResolvedValue('conversation-1')
  mocks.persistUserMessage.mockResolvedValue('message-new')
  mocks.startPersonalWorkflow.mockResolvedValue({
    id: 'agent-run-new',
    userMessageId: 'message-new',
    conversationId: 'conversation-1',
    userId: 'user-1',
    turnId: 'turn-1',
  })
  mocks.startPersonalHarness.mockResolvedValue(undefined)
  mocks.describeNotebookTools.mockResolvedValue([])
  mocks.repositoryGet.mockResolvedValue(mocks.state)
  mocks.readPublicStreamState.mockResolvedValue({
    transcriptSteps: [{
      sequence: 0,
      executionGeneration: 0,
      persistence: { content: '', parts: [{ type: 'text', text: 'Settled response.' }] },
    }],
    nextSequence: null,
    snapshot: { text: 'Settled response.', truncatedMarker: '', receiptId: 'model:1', executionGeneration: 0 },
    status: 'completed',
  })
})

afterEach(() => vi.unstubAllGlobals())

test('reconnect streams the admitted run without persisting or starting another turn', async () => {
  const request = new NextRequest('https://example.test/api/v1/notebook-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      noteId: 'note-1',
      turnId: 'turn-1',
      runId: 'personal:agent-run-1',
      noteContent: 'source markdown',
      noteTitle: 'Notes',
      message: 'Continue the existing turn',
      modelId: 'test-model',
    }),
  })
  const context = {
    auth: { userId: 'user-1', authType: 'session' },
    workspace: { workspace: { id: 'workspace-1' }, principal: { id: 'principal-1' } },
    requestFingerprint: 'fingerprint',
  } as never

  const response = await POST(request, context)
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))

  expect(response.status).toBe(200)
  expect(events[0]).toMatchObject({
    type: 'accepted',
    runId: 'personal:agent-run-1',
    conversationId: 'conversation-1',
    turnId: 'turn-1',
  })
  expect(events.at(-1)).toMatchObject({ type: 'done' })
  expect(events.filter(event => event.type === 'text')).toEqual([
    expect.objectContaining({ type: 'text', text: 'Settled response.' }),
  ])
  expect(mocks.persistUserMessage).not.toHaveBeenCalled()
  expect(mocks.startPersonalWorkflow).not.toHaveBeenCalled()
  expect(mocks.startPersonalHarness).not.toHaveBeenCalled()
})

test('hydrates full Notebook proposals and replays them after their tool-call cursor', async () => {
  const longLine = 'n'.repeat(5_000)
  const edit = {
    id: 'large-edit',
    description: 'Replace a long line',
    startLine: 1,
    endLine: 1,
    originalLines: ['old'],
    newLines: [longLine],
  }
  const fullPersistence = {
    content: '',
    parts: [
      ...Array.from({ length: 82 }, (_, index) => ({ type: 'text', text: `Prefix ${index}.` })),
      {
        type: 'tool-invocation',
        toolInvocation: {
          toolCallId: 'proposal-call',
          toolName: 'propose_edit',
          toolInput: { start_line: 1, new_content: longLine },
          state: 'output-available',
          toolOutput: { success: true, edit },
        },
      },
    ],
  } as unknown as HarnessTranscriptPersistence
  const compacted = compactTranscriptSnapshot(fullPersistence)
  const compactedProposalIndex = compacted.parts.findIndex(part =>
    (part.toolInvocation as Record<string, unknown> | undefined)?.toolName === 'propose_edit')
  const fullProposalIndex = fullPersistence.parts.findIndex(part =>
    (part.toolInvocation as Record<string, unknown> | undefined)?.toolName === 'propose_edit')
  const compactedInvocation = compacted.parts[compactedProposalIndex]!.toolInvocation as Record<string, unknown>
  expect(compactedProposalIndex).not.toBe(fullProposalIndex)
  expect(compactedInvocation.toolOutput).toMatchObject({ truncated: true })

  const serialized = JSON.stringify(fullPersistence)
  const digest = createHash('sha256').update(serialized).digest('hex')
  const compressed = Uint8Array.from(gzipSync(serialized))
  const fetchMock = vi.fn(async () => new Response(compressed.slice().buffer))
  vi.stubGlobal('fetch', fetchMock)
  mocks.readPublicStreamState.mockResolvedValue({
    status: 'completed',
    nextSequence: null,
    snapshot: null,
    transcriptSteps: [{
      sequence: 0,
      executionGeneration: 0,
      persistence: compacted,
      fullPersistenceUrl: 'https://storage.test/notebook',
      fullPersistenceDigest: digest,
    }],
  })

  const context = {
    auth: { userId: 'user-1', authType: 'session' },
    workspace: { workspace: { id: 'workspace-1' }, principal: { id: 'principal-1' } },
    requestFingerprint: 'fingerprint',
  } as never
  const createRequest = (cursor?: string) => new NextRequest('https://example.test/api/v1/notebook-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      noteId: 'note-1',
      turnId: 'turn-1',
      runId: 'personal:agent-run-1',
      ...(cursor ? { cursor } : {}),
      noteContent: 'source markdown',
      noteTitle: 'Notes',
      message: 'Continue the existing turn',
      modelId: 'test-model',
    }),
  })

  const firstResponse = await POST(createRequest(), context)
  const firstEvents = (await firstResponse.text()).trim().split('\n').map(line => JSON.parse(line))
  const toolCall = firstEvents.find(event => event.type === 'tool_call')
  const proposal = firstEvents.find(event => event.type === 'edit_proposal')
  expect(firstResponse.status).toBe(200)
  expect(firstEvents.map(event => event.type)).toEqual([
    'accepted',
    ...Array.from({ length: 82 }, () => 'text'),
    'tool_call',
    'edit_proposal',
    'done',
  ])
  expect(toolCall).toMatchObject({ cursor: `0.${fullProposalIndex * 2}` })
  expect(proposal).toMatchObject({ cursor: `0.${fullProposalIndex * 2 + 1}`, edit })

  const replayResponse = await POST(createRequest(toolCall.cursor), context)
  const replayEvents = (await replayResponse.text()).trim().split('\n').map(line => JSON.parse(line))
  expect(replayEvents.map(event => event.type)).toEqual(['accepted', 'edit_proposal', 'done'])
  expect(replayEvents.filter(event => event.type === 'edit_proposal')).toEqual([
    expect.objectContaining({ cursor: `0.${fullProposalIndex * 2 + 1}`, edit }),
  ])
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('closes after a stream polling failure without a terminal event', async () => {
  mocks.readPublicStreamState.mockRejectedValue(new Error('temporary transport failure'))
  const request = new NextRequest('https://example.test/api/v1/notebook-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      noteId: 'note-1',
      turnId: 'turn-1',
      runId: 'personal:agent-run-1',
      noteContent: 'source markdown',
      noteTitle: 'Notes',
      message: 'Continue the existing turn',
      modelId: 'test-model',
    }),
  })
  const context = {
    auth: { userId: 'user-1', authType: 'session' },
    workspace: { workspace: { id: 'workspace-1' }, principal: { id: 'principal-1' } },
    requestFingerprint: 'fingerprint',
  } as never

  const response = await POST(request, context)
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))

  expect(response.status).toBe(200)
  expect(events.map(event => event.type)).toEqual(['accepted'])
})

test('rejects a retry when a pending turn was persisted with another snapshot', async () => {
  mocks.agentRun = null
  mocks.getLatestAgentRun.mockResolvedValue(null)
  mocks.getRecentMessages.mockResolvedValue([{
    _id: 'message-1',
    role: 'user',
    turnId: 'turn-1',
    content: 'Previous note snapshot and request',
  }])
  mocks.repositoryGet.mockResolvedValue(null)

  const request = new NextRequest('https://example.test/api/v1/notebook-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      noteId: 'note-1',
      turnId: 'turn-1',
      noteContent: 'source markdown',
      noteTitle: 'Notes',
      message: 'Continue the existing turn',
      modelId: 'test-model',
    }),
  })
  const context = {
    auth: { userId: 'user-1', authType: 'session' },
    workspace: { workspace: { id: 'workspace-1' }, principal: { id: 'principal-1' } },
    requestFingerprint: 'fingerprint',
  } as never

  const response = await POST(request, context)

  expect(response.status).toBe(409)
  expect(mocks.persistUserMessage).not.toHaveBeenCalled()
  expect(mocks.startPersonalWorkflow).not.toHaveBeenCalled()
  expect(mocks.startPersonalHarness).not.toHaveBeenCalled()
})

test('rejects a note when resource-level edit access is denied before allocating a run', async () => {
  mocks.agentRun = null
  mocks.getLatestAgentRun.mockResolvedValue(null)
  mocks.repositoryGet.mockResolvedValue(null)
  mocks.checkResolvedResourceAccess.mockResolvedValue({ allowed: false })

  const request = new NextRequest('https://example.test/api/v1/notebook-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      noteId: 'note-1',
      turnId: 'turn-unauthorized',
      noteContent: 'source markdown',
      noteTitle: 'Notes',
      message: 'Make a change',
      modelId: 'test-model',
    }),
  })
  const context = {
    auth: { userId: 'user-1', authType: 'session' },
    workspace: { workspace: { id: 'workspace-1' }, principal: { id: 'principal-1' } },
    requestFingerprint: 'fingerprint',
  } as never

  const response = await POST(request, context)

  expect(response.status).toBe(403)
  expect(mocks.ensureActConversationId).not.toHaveBeenCalled()
  expect(mocks.persistUserMessage).not.toHaveBeenCalled()
  expect(mocks.startPersonalWorkflow).not.toHaveBeenCalled()
  expect(mocks.startPersonalHarness).not.toHaveBeenCalled()
})

test('rejects an API key without chat:write before allocating a run', async () => {
  mocks.agentRun = null
  mocks.getLatestAgentRun.mockResolvedValue(null)
  mocks.repositoryGet.mockResolvedValue(null)
  mocks.apiKeyAllowed.mockResolvedValue(false)
  const request = new NextRequest('https://example.test/api/v1/notebook-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      noteId: 'note-1',
      turnId: 'turn-api-key',
      noteContent: 'source markdown',
      noteTitle: 'Notes',
      message: 'Make a change',
      modelId: 'test-model',
    }),
  })
  const context = {
    auth: { userId: 'user-1', authType: 'api-key', apiKeyId: 'key-1' },
    workspace: { workspace: { id: 'workspace-1' }, principal: { id: 'principal-1' } },
    requestFingerprint: 'fingerprint',
  } as never

  const response = await POST(request, context)

  expect(response.status).toBe(401)
  expect(mocks.ensureActConversationId).not.toHaveBeenCalled()
  expect(mocks.persistUserMessage).not.toHaveBeenCalled()
  expect(mocks.startPersonalWorkflow).not.toHaveBeenCalled()
})

test('fresh admission reuses the note conversation and excludes ungranted search', async () => {
  mocks.agentRun = null
  mocks.getLatestAgentRun.mockResolvedValue(null)
  mocks.getRecentMessages.mockResolvedValue([])
  let messageIndex = 0
  mocks.persistUserMessage.mockImplementation(async () => `message-${++messageIndex}`)
  mocks.startPersonalWorkflow.mockImplementation(async ({
    conversationId,
    turnId,
    userId,
  }: { conversationId: string; turnId: string; userId: string }) => ({
    id: `agent-run-${messageIndex}`,
    userMessageId: `message-${messageIndex}`,
    conversationId,
    userId,
    turnId,
  }))
  mocks.checkResolvedCatalogResourceAccess.mockResolvedValue({ allowed: false })
  let admittedState: Record<string, unknown> | null = null
  mocks.repositoryGet.mockImplementation(async ({ runId }: { runId: string }) =>
    admittedState?.runId === runId ? admittedState : null)
  mocks.startPersonalHarness.mockImplementation(async ({ workflow, agentRun }: {
    workflow: {
      access: { runId: string }
      context: {
        conversationId: string
        turnId: string
        accountAllowedToolIds: string[]
        notebook: { noteId: string; requestDigest: string }
      }
    }
    agentRun: { id: string }
  }) => {
    admittedState = {
      runId: workflow.access.runId,
      policy: {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        allowedToolIds: workflow.context.accountAllowedToolIds,
        surface: {
          kind: 'notebook',
          noteId: workflow.context.notebook.noteId,
          turnId: workflow.context.turnId,
          requestDigest: workflow.context.notebook.requestDigest,
        },
      },
    }
    expect(workflow.access.runId).toBe(`personal:${agentRun.id}`)
  })

  const context = {
    auth: { userId: 'user-1', authType: 'session' },
    workspace: { workspace: { id: 'workspace-1' }, principal: { id: 'principal-1' } },
    requestFingerprint: 'fingerprint',
  } as never
  const responses: Array<{ status: number; events: Array<Record<string, unknown>> }> = []
  for (const [index, turnId] of ['turn-fresh-1', 'turn-fresh-2'].entries()) {
    const request = new NextRequest('https://example.test/api/v1/notebook-agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        noteId: 'note-1',
        turnId,
        noteContent: 'source markdown',
        noteTitle: 'Notes',
        message: `Fresh request ${index + 1}`,
        modelId: 'test-model',
      }),
    })
    const response = await POST(request, context)
    responses.push({
      status: response.status,
      events: (await response.text()).trim().split('\n').map(line => JSON.parse(line)),
    })
  }

  expect(responses.map(response => response.status)).toEqual([200, 200])
  expect(responses.map(response => response.events[0]?.type)).toEqual(['accepted', 'accepted'])
  expect(mocks.persistUserMessage).toHaveBeenCalledTimes(2)
  expect(mocks.startPersonalWorkflow).toHaveBeenCalledTimes(2)
  expect(mocks.startPersonalHarness).toHaveBeenCalledTimes(2)
  expect(mocks.describeNotebookTools.mock.calls).toEqual([[false], [false]])
  expect(mocks.checkResolvedCatalogResourceAccess).toHaveBeenCalledWith(expect.objectContaining({
    capability: 'tools.use',
    resourceId: 'search_knowledge',
    resourceType: 'tool',
  }))
  const conversationCalls = mocks.ensureActConversationId.mock.calls.map(([value]) => value)
  expect(conversationCalls[0].conversationClientId).toBe(conversationCalls[1].conversationClientId)
  expect(conversationCalls[0].conversationClientId).toBe(`notebook-agent-${createHash('sha256')
    .update(JSON.stringify(['user-1', 'workspace-1', 'note-1']))
    .digest('hex').slice(0, 32)}`)
  expect(conversationCalls[0].title).toBe('Notebook: Notes')
  const harnessInputs = mocks.startPersonalHarness.mock.calls.map(([value]) => value)
  expect(harnessInputs.map(value => value.workflow.messages)).toEqual([
    [expect.objectContaining({ role: 'user', content: expect.stringContaining('Fresh request 1') })],
    [expect.objectContaining({ role: 'user', content: expect.stringContaining('Fresh request 2') })],
  ])
  expect(harnessInputs.map(value => value.workflow.context.notebook.content))
    .toEqual(['source markdown', 'source markdown'])
})
