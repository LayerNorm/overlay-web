import assert from 'node:assert/strict'
import test from 'node:test'
import type { UIMessage } from '@/server/ai/sdk'
import { ActContextService } from './ActContextService'
import type { ActConversationRepository } from './ActConversationRepository'
import { ActConversationServiceError, ActEntitlementService } from './ActEntitlementService'
import { ActGeneratingMessageService } from './ActGeneratingMessageService'
import { ActMessagePersistenceService, type ActAssistantFinishEvent } from './ActMessagePersistenceService'
import { ActUsageBudgetService } from './ActUsageBudgetService'
import { UnlimitedUsagePolicy } from './ActUsagePolicy'
import type { Id } from '../../../convex/_generated/dataModel'

const freeEntitlements = {
  tier: 'free',
  planKind: 'free',
  creditsUsed: 0,
  creditsTotal: 0,
  budgetUsedCents: 0,
  budgetTotalCents: 0,
  budgetRemainingCents: 0,
  dailyUsage: { ask: 0, write: 0, agent: 0 },
} as const

function unexpected(name: string): never {
  throw new Error(`Unexpected repository call: ${name}`)
}

function repository(overrides: Partial<ActConversationRepository> = {}): ActConversationRepository {
  return {
    createConversation: () => unexpected('createConversation'),
    getConversationById: () => unexpected('getConversationById'),
    listConversations: () => unexpected('listConversations'),
    listConversationsByProject: () => unexpected('listConversationsByProject'),
    getRecentMessages: () => unexpected('getRecentMessages'),
    getConversationMessages: () => unexpected('getConversationMessages'),
    updateConversation: () => unexpected('updateConversation'),
    deleteConversation: () => unexpected('deleteConversation'),
    getEntitlements: () => unexpected('getEntitlements'),
    getAppSettings: () => unexpected('getAppSettings'),
    getMessages: () => unexpected('getMessages'),
    addMessage: () => unexpected('addMessage'),
    listMemories: () => unexpected('listMemories'),
    listSkills: () => unexpected('listSkills'),
    getConversation: () => unexpected('getConversation'),
    getProject: () => unexpected('getProject'),
    getContextSummary: () => unexpected('getContextSummary'),
    upsertContextSummary: () => unexpected('upsertContextSummary'),
    startGeneratingMessage: () => unexpected('startGeneratingMessage'),
    appendGeneratingMessageDelta: () => unexpected('appendGeneratingMessageDelta'),
    finalizeGeneratingMessage: () => unexpected('finalizeGeneratingMessage'),
    failGeneratingMessage: () => unexpected('failGeneratingMessage'),
    settleGeneratingMessagesForTurn: () => unexpected('settleGeneratingMessagesForTurn'),
    stopGeneratingMessages: () => unexpected('stopGeneratingMessages'),
    deleteTurn: () => unexpected('deleteTurn'),
    updateMessageUiPart: () => unexpected('updateMessageUiPart'),
    setShare: () => unexpected('setShare'),
    getPublicConversationByToken: () => unexpected('getPublicConversationByToken'),
    getConversationEventCursor: () => unexpected('getConversationEventCursor'),
    listConversationEvents: () => unexpected('listConversationEvents'),
    waitForConversationEvents: () => unexpected('waitForConversationEvents'),
    recordUsageBatch: () => unexpected('recordUsageBatch'),
    ...overrides,
  }
}

test('act entitlement service preserves premium-model free-tier gate shape', async () => {
  const service = new ActEntitlementService({
    repository: repository({
      getEntitlements: async () => freeEntitlements,
      getAppSettings: async () => null,
    }),
  })

  await assert.rejects(
    () => service.gateModelAccess({
      effectiveModelId: 'claude-sonnet-4-6',
      userId: 'user_1',
    }),
    (error) => {
      assert.equal(error instanceof ActConversationServiceError, true)
      assert.equal((error as ActConversationServiceError).statusCode, 403)
      assert.deepEqual((error as ActConversationServiceError).payload, {
        error: 'premium_model_not_allowed',
        message: 'Free tier is limited to free models. Upgrade to a paid plan to use premium models.',
      })
      return true
    },
  )
})

test('act context service builds model history without current turn or other assistant model variants', async () => {
  const service = new ActContextService({
    repository: repository({
      getMessages: async () => [
        {
          _id: 'old_user',
          turnId: 'turn_old',
          role: 'user',
          modelId: 'claude-sonnet-4-6',
          content: 'old prompt',
        },
        {
          _id: 'old_assistant_same_model',
          turnId: 'turn_old',
          role: 'assistant',
          modelId: 'claude-sonnet-4-6',
          content: 'old answer',
        },
        {
          _id: 'old_assistant_other_model',
          turnId: 'turn_old',
          role: 'assistant',
          modelId: 'gpt-5',
          content: 'other answer',
        },
        {
          _id: 'current_user_persisted',
          turnId: 'turn_current',
          role: 'user',
          modelId: 'claude-sonnet-4-6',
          content: 'current persisted',
        },
      ],
    }),
  })
  const latestUserMessage: UIMessage = {
    id: 'latest',
    role: 'user',
    parts: [{ type: 'text', text: 'current prompt' }],
  }

  const messages = await service.buildMessagesForModel({
    conversationId: 'conversation_1' as Id<'conversations'>,
    historyBaseModelId: 'claude-sonnet-4-6',
    latestTurnId: 'turn_current',
    latestUserMessage,
    requestMessages: [latestUserMessage],
    targetModelId: 'claude-sonnet-4-6',
    userId: 'user_1',
  })

  assert.deepEqual(messages.map((message) => message.id), [
    'old_user',
    'old_assistant_same_model',
    'latest',
  ])
})

test('act context service keeps auto retrieval enabled when external provider context is disabled', async () => {
  let retrievalArgs: Record<string, unknown> | undefined
  const service = new ActContextService({
    repository: repository({
      getConversation: async () => ({ projectId: 'project_1' }),
      getProject: async () => ({ instructions: 'Project rules' }),
      listMemories: async () => [],
      listSkills: async () => [],
    }),
    buildAutoRetrievalBundle: async (args) => {
      retrievalArgs = args
      return {
        extension: '\nAUTO_RETRIEVED_KNOWLEDGE',
        citations: { '1': { kind: 'memory', sourceId: 'memory_1' } },
      }
    },
  })

  const context = await service.loadTurnContext({
    conversationId: 'conversation_1' as Id<'conversations'>,
    externalContextEnabled: false,
    indexedAttachments: [],
    latestUserText: 'What is the deployment checkpoint?',
    memoryEnabled: true,
    mentions: [{ type: 'file', id: 'file_1', name: 'Runbook' }],
    serverSecret: 'server-secret',
    userId: 'user_1',
  })

  assert.deepEqual(retrievalArgs, {
    includeMemories: true,
    projectId: 'project_1',
    userId: 'user_1',
    userMessage: 'What is the deployment checkpoint?',
  })
  assert.equal(context.autoRetrieval, '\nAUTO_RETRIEVED_KNOWLEDGE')
  assert.deepEqual(context.sourceCitationMap, {
    '1': { kind: 'memory', sourceId: 'memory_1' },
  })
  assert.equal(context.mentionsContext, '')
})

test('act context service preloads attached documents through the active file repository', async () => {
  const loadedFileIds: string[] = []
  const service = new ActContextService({
    repository: repository({
      getConversation: async () => null,
      listMemories: async () => [],
      listSkills: async () => [],
    }),
    buildAutoRetrievalBundle: async () => ({ extension: '', citations: {} }),
    loadDocumentFile: async ({ fileId, userId }) => {
      loadedFileIds.push(fileId)
      return {
        _id: fileId,
        name: 'runbook.pdf',
        textContent: 'The deployment checkpoint is green.',
        userId,
      }
    },
  })

  const context = await service.loadTurnContext({
    externalContextEnabled: false,
    indexedAttachments: [{ name: 'runbook.pdf', fileIds: ['file_1'] }],
    latestUserText: 'What is the deployment checkpoint?',
    serverSecret: 'server-secret',
    userId: 'user_1',
  })

  assert.deepEqual(loadedFileIds, ['file_1'])
  assert.equal(context.hasPreloadedDocContext, true)
  assert.match(context.docContextBundle.contextText, /deployment checkpoint is green/)
})

test('act message persistence swallows user-message persistence failures', async () => {
  let addMessageCalls = 0
  const generatingMessages = new ActGeneratingMessageService({
    repository: repository(),
  })
  const service = new ActMessagePersistenceService({
    generatingMessages,
    repository: repository({
      addMessage: async () => {
        addMessageCalls += 1
        throw new Error('write failed')
      },
    }),
  })

  await service.persistUserMessage({
    conversationId: 'conversation_1' as Id<'conversations'>,
    latestUserContent: 'hello',
    latestUserParts: [{ type: 'text', text: 'hello' }],
    latestUserText: 'hello',
    modelId: 'openrouter/free',
    skip: false,
    turnId: 'turn_1',
    userId: 'user_1',
  })

  assert.equal(addMessageCalls, 1)
})

test('act assistant persistence finalizes generating messages and emits completion', async () => {
  const completions: Array<{ conversationId: string; modelId: string; turnId: string; userId: string }> = []
  let finalized: { content: string; parts: Array<Record<string, unknown>> } | undefined
  const generatingMessages = new ActGeneratingMessageService({
    repository: repository({
      finalizeGeneratingMessage: async (args) => {
        finalized = { content: args.content, parts: args.parts }
      },
    }),
  })
  const service = new ActMessagePersistenceService({
    events: {
      completed: (event) => completions.push(event),
    },
    generatingMessages,
    repository: repository(),
  })

  await service.persistAssistantFinish({
    attemptModelId: 'claude-sonnet-4-6',
    conversationId: 'conversation_1' as Id<'conversations'>,
    emitWebhook: true,
    event: {
      steps: [],
      text: 'done\n\n**Sources:** [1]',
      totalUsage: { inputTokens: 3, outputTokens: 4 },
    } as ActAssistantFinishEvent,
    finishedToolCallIds: new Set(),
    generatingMessageId: 'message_1' as Id<'conversationMessages'>,
    multiModelSlotIndex: 0,
    multiModelTotal: 1,
    sourceCitations: {
      '1': { kind: 'memory', sourceId: 'memory_1' },
    },
    timedOut: false,
    timeoutMs: 30_000,
    toolFailuresByCallId: new Map(),
    turnId: 'turn_1',
    userId: 'user_1',
  })

  const persistedText = 'done\n\n**Sources:** [1](/app/settings?section=memories&memory=memory_1)'
  assert.equal(finalized?.content, persistedText)
  assert.deepEqual(finalized?.parts, [{ type: 'text', text: persistedText }])
  assert.deepEqual(completions, [{
    conversationId: 'conversation_1',
    modelId: 'claude-sonnet-4-6',
    turnId: 'turn_1',
    userId: 'user_1',
  }])
})

test('act usage budget service skips reservations for unpaid/free-model attempts', async () => {
  const service = new ActUsageBudgetService({
    repository: repository(),
  })

  const result = await service.reserveForAttempt({
    entitlements: freeEntitlements,
    estimatedInputTokens: 1000,
    maxOutputTokens: 1000,
    modelId: 'openrouter/free',
    paid: false,
    userId: 'user_1',
  })

  assert.deepEqual(result, { ok: true, reservationId: null })
})

test('unlimited usage policy exposes explicit paid entitlements and no-op accounting', async () => {
  const policy = new UnlimitedUsagePolicy()
  const entitlements = await policy.getEntitlements({ userId: 'user_1' })

  assert.equal(entitlements.planKind, 'paid')
  assert.equal(entitlements.tier, 'max')
  assert.equal((entitlements.budgetRemainingCents ?? 0) > 1_000_000_000, true)
  assert.deepEqual(await policy.reserveForAttempt({
    entitlements,
    estimatedInputTokens: 1000,
    maxOutputTokens: 1000,
    modelId: 'claude-sonnet-4-6',
    paid: true,
    userId: 'user_1',
  }), { ok: true, reservationId: null })
  assert.deepEqual(await policy.recordFinishedUsage({
    forceFreeTierLimits: false,
    inputTokens: 12,
    modelId: 'claude-sonnet-4-6',
    outputTokens: 24,
    reservationId: null,
    userId: 'user_1',
  }), { finalized: false, reservationId: null })
})
