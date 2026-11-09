import { beforeEach, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { notebookRequestDigest } from '@/server/notebook/notebook-agent-identity'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  note: null as unknown,
  state: null as unknown,
  agentRun: null as unknown,
  conversation: null as unknown,
  checkCapability: vi.fn(),
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
    authorizationService: { checkCapability: mocks.checkCapability },
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
    async get() { return mocks.repositoryGet() }
    async readPublicStreamState() { return mocks.readPublicStreamState() }
  },
}))
vi.mock('@/server/harness/personal-admission', () => ({
  PersonalHarnessAdmissionConflict: class extends Error {},
  PersonalHarnessStartPending: class extends Error {},
  personalHarnessAuthentication: vi.fn(),
  startPersonalHarness: mocks.startPersonalHarness,
}))
vi.mock('@/server/notebook/notebook-agent-tools', () => ({
  describeNotebookTools: vi.fn(),
}))

beforeEach(() => {
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
    source: { conversationId: 'conversation-1' },
    policy: {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      allowedToolIds: ['read_note', 'propose_edit', 'finish'],
      surface: { kind: 'notebook', noteId: 'note-1', turnId: 'turn-1', requestDigest },
    },
  }
  mocks.agentRun = { id: 'agent-run-1' }
  mocks.conversation = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    conversationType: 'personal',
  }
  mocks.checkCapability.mockResolvedValue({ allowed: true })
  mocks.gateModelAccess.mockResolvedValue({ paid: true, runtimeEntitlements: {} })
  mocks.getConversationById.mockResolvedValue(mocks.conversation)
  mocks.getLatestAgentRun.mockResolvedValue(mocks.agentRun)
  mocks.getRecentMessages.mockResolvedValue([])
  mocks.ensureActConversationId.mockResolvedValue('conversation-1')
  mocks.repositoryGet.mockResolvedValue(mocks.state)
  mocks.readPublicStreamState.mockResolvedValue({
    transcriptSteps: [],
    nextSequence: null,
    snapshot: null,
    status: 'completed',
  })
})

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
  expect(mocks.persistUserMessage).not.toHaveBeenCalled()
  expect(mocks.startPersonalWorkflow).not.toHaveBeenCalled()
  expect(mocks.startPersonalHarness).not.toHaveBeenCalled()
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
