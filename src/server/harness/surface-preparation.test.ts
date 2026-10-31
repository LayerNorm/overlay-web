import { beforeEach, expect, test, vi } from 'vitest'
import { prepareAutomationAgentTurn } from '@/server/automations/automation-turn-runner'
import { surfaceHarnessTurnId } from './surface-authority'

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  gateModelAccess: vi.fn(),
  resolveBillingPayer: vi.fn(),
  authorizeActRequest: vi.fn(),
  persistUserMessage: vi.fn(),
  loadTurnContext: vi.fn(),
  buildMessages: vi.fn(),
  prepareExisting: vi.fn(),
  preloadTools: vi.fn(),
  filterCatalog: vi.fn(),
  prepareTooling: vi.fn(),
  describeTools: vi.fn(),
  reserve: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  workspaceService: { resolveActiveWorkspace: mocks.workspace },
  appDataCapabilities: {},
  authorizationService: {},
}) }))
vi.mock('@/server/ai/sdk', () => ({
  convertToModelMessages: vi.fn(async messages => messages),
  generateText: vi.fn(),
}))
vi.mock('@/server/ai/model-runtime', () => ({ getLanguageModel: vi.fn(), isSubscriptionModelForUser: vi.fn() }))
vi.mock('@/server/chat/context-compaction', () => ({ summaryGenerationOptions: vi.fn() }))
vi.mock('@/shared/ai/gateway/model-data', () => ({ modelSupportsZeroDataRetention: vi.fn(() => false) }))
vi.mock('@/shared/ai/gateway/model-types', () => ({
  FREE_TIER_DEFAULT_MODEL_ID: 'free/model',
  DEFAULT_MODEL_ID: 'default/model',
}))
vi.mock('@/shared/ai/gateway/byok-model-conversion', () => ({ isByokModelId: vi.fn(() => false) }))
vi.mock('@/server/ai/model-policy-authority', () => ({
  resolveAuthorizedModelIds: vi.fn(async () => ({ chat: new Set(['provider/model']) })),
}))
vi.mock('@/server/billing/automation-workflow-billing', () => ({ meterAutomationWorkflowRun: vi.fn() }))
vi.mock('@/server/billing/billing-runtime', () => ({
  resolveBillingPayer: mocks.resolveBillingPayer,
}))
vi.mock('@/server/billing/ServerProviderUsageMeter', () => ({ providerRequestFingerprint: vi.fn(() => 'fingerprint') }))
vi.mock('@/server/conversations/ActConversationRepository', () => ({
  asConversationId: (id: string) => id,
}))
vi.mock('@/server/conversations/personal-chat-work-tools', () => ({
  describePersonalChatWorkTools: mocks.describeTools,
}))
vi.mock('@/server/conversations/http', () => ({
  actContextService: {
    loadTurnContext: mocks.loadTurnContext,
    buildMessagesForModel: mocks.buildMessages,
    prepareExistingMessagesForModel: mocks.prepareExisting,
  },
  actEntitlementService: { gateModelAccess: mocks.gateModelAccess },
  actMessagePersistenceService: { persistUserMessage: mocks.persistUserMessage },
  actUsageBudgetService: { reserveForAttempt: mocks.reserve },
}))
vi.mock('@/server/shared/internal-api-secret', () => ({ getInternalApiSecret: () => 'server-secret' }))
vi.mock('@/server/observability/logger', () => ({ logger: { warn: vi.fn() } }))
vi.mock('@/shared/security/safe-log', () => ({ summarizeErrorForLog: vi.fn(() => 'safe') }))
vi.mock('@/server/agent/operator-system-prompt', () => ({ buildSecondarySystemPromptExtension: vi.fn(() => '') }))
vi.mock('@/server/agent/knowledge-agent-instructions', () => ({
  ACT_KNOWLEDGE_TOOLS_NOTE_NO_WEB: '',
  ACT_KNOWLEDGE_WEB_TOOLS_NOTE: '',
  ACT_PAID_PLAN_ACT_TOOLS_REALITY: '',
  FREE_TIER_NO_PAID_AGENT_CAPABILITIES: '',
  MEMORY_SAVE_PROTOCOL: '',
  cloneMessagesWithIndexedFileHint: vi.fn(messages => messages),
  indexedFilesSystemNote: vi.fn(() => ''),
  indexedFilesSystemNotePreloaded: vi.fn(() => ''),
}))
vi.mock('@/shared/markdown/math-format-instructions', () => ({ MATH_FORMAT_INSTRUCTION: '' }))
vi.mock('@/shared/markdown/markdown-table-instructions', () => ({ TABLE_FORMAT_INSTRUCTION: '' }))
vi.mock('@/server/app-api/v1/conversations/act/instructions', () => ({
  buildActAgentInstructions: vi.fn(() => 'prepared instructions'),
}))
vi.mock('@/server/app-api/v1/conversations/act/route-helpers', () => ({
  resolveEffectiveActModelId: (id: string) => id ?? 'provider/model',
}))
vi.mock('@/server/app-api/v1/conversations/act/turn-authorization', () => ({
  authorizeActRequest: mocks.authorizeActRequest,
}))
vi.mock('@/server/app-api/v1/conversations/act/tooling', () => ({
  prepareActTooling: mocks.prepareTooling,
  preloadActExternalToolTasks: mocks.preloadTools,
}))
vi.mock('@/server/authorization', () => ({ filterCatalogResources: mocks.filterCatalog }))
vi.mock('@/server/tools/media-tool-intent', () => ({
  classifyMediaToolIntentForTurn: vi.fn(),
  mayNeedMediaGenerationTools: vi.fn(() => false),
}))
vi.mock('@/shared/knowledge/mention-tokens', () => ({ parseMentionTokens: vi.fn(() => []) }))
vi.mock('@/shared/automations/automation-prompts', () => ({
  buildAutomationSystemPrompt: vi.fn(() => ''),
  buildAutomationUserMessage: vi.fn(() => ''),
}))
vi.mock('@/shared/surfaces/surface-prompts', () => ({ buildSurfaceSystemPrompt: vi.fn(() => 'Surface agent prompt') }))
vi.mock('@/server/agents/agent-tooling', () => ({
  applyAgentCapabilityFilter: vi.fn(({ tools }) => tools),
  resolveAgentGrant: ({ allowedToolIds }: { allowedToolIds: string[] }) => ({
    overlayToolIds: allowedToolIds,
    capabilities: new Set(['integrations']),
  }),
}))
vi.mock('@/shared/agents/agent-memory', () => ({ agentMemoryOwnerId: (agentId: string) => `agent-memory:${agentId}` }))
vi.mock('@/server/web/app-url', () => ({ getBaseUrl: () => 'https://overlay.example' }))
vi.mock('@/server/automations/http', () => ({ automationService: {} }))

const authority = {
  type: 'surface' as const,
  platform: 'slack' as const,
  bindingId: 'binding',
  connectionId: 'connection',
  teamId: 'team',
  channelId: 'channel',
  threadId: 'thread',
  messageId: 'message',
  agentId: 'agent',
  agentPrincipalId: 'agent-principal',
  creatorPrincipalId: 'principal',
  originWorkflowRunId: 'workflow',
}
const input = {
  userId: 'user',
  name: 'Current Agent',
  instructions: 'Raw Slack message',
  turnId: surfaceHarnessTurnId(authority),
  scheduledFor: 1,
  workspaceId: 'workspace',
  conversationId: 'conversation',
  modelId: 'provider/model',
  surface: {
    ...authority,
    agentName: 'Current Agent',
    agentInstructions: 'Agent persona',
    agentPrincipalId: 'agent-principal',
    agentAllowedToolIds: ['read_file'],
    agentPermissionMode: 'auto' as const,
    agentIsDefault: false,
    creatorPrincipalId: 'principal',
    authorName: 'Slack Author',
    authorExternalId: 'external-author',
    authorEmail: 'author@example.test',
    authorStatus: 'member' as const,
  },
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.workspace.mockResolvedValue({ workspace: { id: 'workspace' }, principal: { id: 'principal' } })
  mocks.gateModelAccess.mockResolvedValue({ paid: true, runtimeEntitlements: { paid: true } })
  mocks.resolveBillingPayer.mockResolvedValue({
    scope: 'user',
    subject: { id: 'billing-subject', kind: 'user' },
  })
  mocks.authorizeActRequest.mockResolvedValue(null)
  mocks.persistUserMessage.mockResolvedValue('persisted-user-message')
  mocks.loadTurnContext.mockResolvedValue({
    autoRetrieval: false,
    docContextBundle: { contextText: '' },
    hasPreloadedDocContext: false,
    indexedAttachmentList: [],
    memoryContext: '',
    mentionsContext: '',
    skillsContext: '',
    sourceCitationMap: {},
  })
  mocks.buildMessages.mockImplementation(async ({ requestMessages }) => requestMessages)
  mocks.prepareExisting.mockImplementation(async ({ messages }) => messages)
  mocks.preloadTools.mockReturnValue({ connectedConnectorIdsTask: Promise.resolve(['connector']) })
  mocks.filterCatalog.mockImplementation(async ({ values }) => values)
  mocks.prepareTooling.mockResolvedValue({
    tools: { read_file: {} },
    allowedOverlayToolIds: ['read_file'],
    integrationToolIds: ['connector_tool'],
    exposedMediaTools: [],
  })
  mocks.describeTools.mockResolvedValue([{ name: 'read_file' }])
})

test('surface preparation carries captured source metadata without turn-wide usage reservation', async () => {
  const plan = await prepareAutomationAgentTurn(input)
  expect(plan).toMatchObject({
    reservationId: null,
    userMessageId: 'persisted-user-message',
    toolingContext: {
      turnId: input.turnId,
      billingProgrammaticSubjectId: 'surface:slack:binding',
      memoryOwnerId: 'agent-memory:agent',
      automationExecution: true,
      approvalMode: 'auto',
      accountAllowedToolIds: ['read_file'],
      accountAllowedConnectorIds: ['connector'],
      integrationToolIds: ['connector_tool'],
    },
  })
  expect(plan.toolingContext).not.toHaveProperty('automationId')
  expect(plan.toolingContext).not.toHaveProperty('automationRunId')
  expect(mocks.persistUserMessage).toHaveBeenCalledWith(expect.objectContaining({
    turnId: input.turnId,
    latestUserText: 'Raw Slack message',
    importedAuthorName: 'Slack Author',
    importedAuthorEmail: 'author@example.test',
    importedAuthorStatus: 'member',
    skip: false,
  }))
  expect(mocks.prepareTooling).toHaveBeenCalledWith(expect.objectContaining({
    accountAllowedToolIds: ['read_file'],
    automationExecution: true,
    agentId: 'agent',
    agentPrincipalId: 'agent-principal',
    billingProgrammaticSubjectId: 'surface:slack:binding',
    memoryOwnerId: 'agent-memory:agent',
    approvalMode: 'auto',
  }))
  expect(mocks.reserve).not.toHaveBeenCalled()
})
