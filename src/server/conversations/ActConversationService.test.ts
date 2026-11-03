import assert from 'node:assert/strict'
import test from 'node:test'
import type { UIMessage } from '@/server/ai/sdk'
import { ActContextService } from './ActContextService'
import type { ActConversationRepository } from './ActConversationRepository'
import { ActConversationServiceError, ActEntitlementService } from './ActEntitlementService'
import { WorkspaceExecutionError } from '@/server/billing/WorkspaceExecutionPolicy'
import { ActMessagePersistenceService, type ActAssistantFinishEvent } from './ActMessagePersistenceService'
import { ActUsageBudgetService } from './ActUsageBudgetService'
import { UnlimitedUsagePolicy } from './ActUsagePolicy'
import type { Id } from '../../../convex/_generated/dataModel'
import { asConversationId } from './ActConversationRepository'
import { ensureActConversationId } from './ensure-act-conversation'

function unexpected(name: string): never {
  throw new Error(`Unexpected repository call: ${name}`)
}

function repository(overrides: Partial<ActConversationRepository> = {}): ActConversationRepository {
  return {
    createConversation: () => unexpected('createConversation'),
    getConversationById: () => unexpected('getConversationById'),
    getNativeThreadCompatibility: () => unexpected('getNativeThreadCompatibility'),
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
    getContextSummary: () => unexpected('getContextSummary'),
    upsertContextSummary: () => unexpected('upsertContextSummary'),
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

const paidEntitlements = {
  tier: 'pro' as const,
  planKind: 'paid' as const,
  creditsUsed: 0,
  creditsTotal: 100,
  budgetUsedCents: 0,
  budgetTotalCents: 10_000,
  budgetRemainingCents: 10_000,
  dailyUsage: { ask: 0, write: 0, agent: 0 },
  dailyLimits: { ask: 0, write: 0, agent: 0 },
}

test('parallel first-send creation preserves workspace identity and requested scope', async () => {
  for (const scope of ['personal', 'workspace', undefined] as const) {
    let created: Parameters<ActConversationRepository['createConversation']>[0] | undefined
    const id = await ensureActConversationId({
      userId: 'user_1',
      workspaceId: 'workspace_1',
      createdByPrincipalId: 'principal_1',
      scope,
      conversationClientId: 'client_1',
      entitlements: paidEntitlements,
      repository: repository({
        createConversation: async (args) => {
          created = args
          return asConversationId('conversation_1')
        },
      }),
    })
    assert.equal(id, 'conversation_1')
    assert.equal(created?.scope, scope)
    assert.equal(created?.workspaceId, 'workspace_1')
    assert.equal(created?.createdByPrincipalId, 'principal_1')
    assert.equal(created?.clientId, 'client_1')
  }
})

test('act entitlement service maps workspace execution refusals without allowing BYO exceptions', async () => {
  const service = new ActEntitlementService({
    requireExecution: async () => {
      throw new WorkspaceExecutionError({ state: 'subscription_required', canExecute: false }, true)
    },
    repository: repository({
      getEntitlements: async () => paidEntitlements,
      getAppSettings: async () => null,
    }),
  })

  await assert.rejects(
    () => service.gateModelPolicy({
      effectiveModelId: 'claude-sonnet-4-6',
      userId: 'user_1',
    }),
    (error) => {
      assert.equal(error instanceof ActConversationServiceError, true)
      assert.equal((error as ActConversationServiceError).statusCode, 402)
      assert.deepEqual((error as ActConversationServiceError).payload, {
        error: 'subscription_required',
        code: 'subscription_required',
        message: 'Subscribe to this workspace before starting work.',
        recovery: 'billing',
      })
      return true
    },
  )
  await assert.rejects(service.gateModelPolicy({
    effectiveModelId: 'byok/connection_1/vendor/model-a',
    userId: 'user_1',
  }), (error: unknown) => error instanceof ActConversationServiceError && error.statusCode === 402)
})

test('policy-only authorization requires paid workspace admission without checking funds', async () => {
  const entitlements = { ...paidEntitlements, budgetTotalCents: 100, budgetRemainingCents: 0 }
  let reads = 0
  let checkBudget: boolean | undefined
  const service = new ActEntitlementService({
    requireExecution: async (args) => {
      checkBudget = args.checkBudget
      return { billingEnabled: true } as never
    },
    repository: repository({
      getEntitlements: async () => { reads++; return entitlements },
      getAppSettings: async () => null,
    }),
  })
  const result = await service.gateModelPolicy({ effectiveModelId: 'fixture/paid-model', userId: 'user_1' })
  assert.equal(result.paid, true)
  assert.equal(result.runtimeEntitlements, entitlements)
  assert.equal(result.runtimeEntitlements.budgetRemainingCents, 0)
  assert.equal(checkBudget, false)
  assert.equal(reads, 1)
})

test('new chat admission rechecks available workspace budget after policy authorization', async () => {
  const entitlements = { ...paidEntitlements, budgetTotalCents: 100, budgetRemainingCents: 100 }
  const checks: boolean[] = []
  const service = new ActEntitlementService({
    requireExecution: async (args) => {
      checks.push(args.checkBudget ?? true)
      return { billingEnabled: true } as never
    },
    repository: repository({
      getEntitlements: async () => entitlements,
      getAppSettings: async () => null,
    }),
  })
  const result = await service.gateModelAccess({ effectiveModelId: 'fixture/paid-model', userId: 'user_1' })

  assert.deepEqual(checks, [false, true])
  assert.equal(result.paid, true)
  assert.equal(result.runtimeEntitlements.budgetRemainingCents, 100)
})

test('billing-disabled admin admission is paid and retired free models are refused', async () => {
  const service = new ActEntitlementService({
    requireExecution: async () => ({ billingEnabled: false } as never),
    repository: repository({
      getEntitlements: async () => paidEntitlements,
      getAppSettings: async () => null,
    }),
  })
  assert.equal((await service.gateModelAccess({ effectiveModelId: 'fixture/paid-model', userId: 'user_1' })).paid, true)
  for (const effectiveModelId of ['overlay-free', 'openrouter/free', 'openrouter/example:free']) {
    await assert.rejects(
      service.gateModelPolicy({ effectiveModelId, userId: 'user_1' }),
      (error: unknown) => error instanceof ActConversationServiceError && error.payload.error === 'model_retired',
    )
  }
})

test('policy-only authorization enforces ZDR settings for all models', async () => {
  const restricted = new ActEntitlementService({
    requireExecution: async () => ({ billingEnabled: false } as never),
    repository: repository({
      getEntitlements: async () => paidEntitlements,
      getAppSettings: async () => ({ onlyAllowZdrModels: true }) as never,
    }),
  })
  await assert.rejects(restricted.gateModelPolicy({ effectiveModelId: 'byok/connection/model', userId: 'user_1' }),
    (error: unknown) => error instanceof ActConversationServiceError && error.payload.error === 'zdr_model_required')
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
      getConversation: async () => ({ _id: 'conv_1' }),
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
    billingUserId: 'user_1',
    conversationId: 'conversation_1' as Id<'conversations'>,
    externalContextEnabled: false,
    indexedAttachments: [],
    latestUserText: 'What is the deployment checkpoint?',
    memoryEnabled: true,
    mentions: [{ type: 'file', id: 'file_1', name: 'Runbook' }],
    requestIdempotencyKey: 'act-test-idempotency',
    requestFingerprint: 'act-test-fingerprint',
    serverSecret: 'server-secret',
    userId: 'user_1',
  })

  assert.deepEqual(retrievalArgs, {
    billing: {
      actorUserId: 'user_1',
      idempotencyKey: 'act-test-idempotency',
      operationId: 'conversation.act.auto-retrieval',
      requestFingerprint: 'act-test-fingerprint',
    },
    includeMemories: true,
    userId: 'user_1',
    userMessage: 'What is the deployment checkpoint?',
  })
  assert.equal(context.autoRetrieval, '\nAUTO_RETRIEVED_KNOWLEDGE')
  assert.deepEqual(context.sourceCitationMap, {
    '1': { kind: 'memory', sourceId: 'memory_1' },
  })
  assert.equal(context.mentionsContext, '')
})

test('act context service loads persistent memory from the active workspace', async () => {
  let memoryArgs: { userId: string; workspaceId?: string } | undefined
  const service = new ActContextService({
    repository: repository({
      getConversation: async () => null,
      listMemories: async (args) => {
        memoryArgs = args
        return [{ content: 'The workspace requires SOC 2 evidence.', importance: 5 }]
      },
      listSkills: async () => [],
    }),
    buildAutoRetrievalBundle: async () => ({ extension: '', citations: {} }),
  })

  const context = await service.loadTurnContext({
    billingUserId: 'user_a',
    externalContextEnabled: false,
    indexedAttachments: [],
    requestIdempotencyKey: 'workspace-memory-idempotency',
    requestFingerprint: 'workspace-memory-fingerprint',
    serverSecret: 'server-secret',
    userId: 'user_a',
    workspaceId: 'workspace_1',
  })

  assert.deepEqual(memoryArgs, { userId: 'user_a', workspaceId: 'workspace_1' })
  assert.match(context.memoryContext, /workspace requires SOC 2 evidence/)
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
    requestIdempotencyKey: 'act-document-idempotency',
    requestFingerprint: 'act-document-fingerprint',
    serverSecret: 'server-secret',
    userId: 'user_1',
  })

  assert.deepEqual(loadedFileIds, ['file_1'])
  assert.equal(context.hasPreloadedDocContext, true)
  assert.match(context.docContextBundle.contextText, /deployment checkpoint is green/)
})

test('act message persistence surfaces user-message persistence failures', async () => {
  let addMessageCalls = 0
  const service = new ActMessagePersistenceService({
    repository: repository({
      addMessage: async () => {
        addMessageCalls += 1
        throw new Error('write failed')
      },
    }),
  })

  await assert.rejects(
    service.persistUserMessage({
      conversationId: 'conversation_1' as Id<'conversations'>,
      latestUserContent: 'hello',
      latestUserParts: [{ type: 'text', text: 'hello' }],
      latestUserText: 'hello',
      modelId: 'openrouter/free',
      skip: false,
      turnId: 'turn_1',
      userId: 'user_1',
    }),
    /write failed/,
  )

  assert.equal(addMessageCalls, 1)
})

test('act assistant persistence writes one final message and emits completion', async () => {
  const completions: Array<{ conversationId: string; modelId: string; turnId: string; userId: string }> = []
  let finalized: { content: string; parts: Array<Record<string, unknown>> } | undefined
  const service = new ActMessagePersistenceService({
    events: {
      completed: (event) => completions.push(event),
    },
    repository: repository({
      addMessage: async (args) => {
        finalized = { content: args.content, parts: args.parts }
        return 'message_1' as Id<'conversationMessages'>
      },
    }),
  })

  await service.persistAssistantFinish({
    attemptModelId: 'claude-sonnet-4-6',
    conversationId: 'conversation_1' as Id<'conversations'>,
    emitWebhook: true,
    event: {
      steps: [],
      text: 'done\n\n**Sources:** [1]',
      usage: { inputTokens: 3, outputTokens: 4 },
    } as ActAssistantFinishEvent,
    finishedToolCallIds: new Set(),
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

test('act usage budget service never charges BYOK attempts', async () => {
  const service = new ActUsageBudgetService({ repository: repository() })
  const modelId = 'byok/connection_1/vendor/model-a'

  assert.deepEqual(await service.reserveForAttempt({
    entitlements: {
      tier: 'pro',
      planKind: 'paid',
      creditsUsed: 0,
      creditsTotal: 100,
      budgetUsedCents: 0,
      budgetTotalCents: 10_000,
      budgetRemainingCents: 10_000,
    },
    estimatedInputTokens: 1000,
    maxOutputTokens: 1000,
    modelId,
    operationId: 'conversation.act',
    paid: true,
    requestFingerprint: 'byok-attempt',
    userId: 'user_1',
  }), { ok: true, reservationId: null })

  assert.deepEqual(await service.recordFinishedUsage({
    inputTokens: 100,
    modelId,
    outputTokens: 50,
    reservationId: null,
    userId: 'user_1',
  }), { finalized: false, reservationId: null })
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
    operationId: 'conversation.act',
    paid: true,
    requestFingerprint: 'unlimited-attempt',
    userId: 'user_1',
  }), { ok: true, reservationId: null })
  assert.deepEqual(await policy.recordFinishedUsage({
    inputTokens: 12,
    modelId: 'claude-sonnet-4-6',
    outputTokens: 24,
    reservationId: null,
    userId: 'user_1',
  }), { finalized: false, reservationId: null })
})
