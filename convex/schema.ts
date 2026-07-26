import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  userUiSettings: defineTable({
    userId: v.string(),
    theme: v.union(v.literal('light'), v.literal('dark')),
    lightThemePreset: v.optional(v.string()),
    darkThemePreset: v.optional(v.string()),
    useSecondarySidebar: v.boolean(),
    chatStreamingMode: v.optional(v.union(v.literal('token'), v.literal('chunk'))),
    autoContinue: v.optional(v.boolean()),
    defaultChatMode: v.optional(v.union(v.literal('ask'), v.literal('act'))),
    modelPreference: v.optional(v.union(v.literal('same-for-each-chat'), v.literal('different-for-each-chat'))),
    defaultAskModelIds: v.optional(v.array(v.string())),
    defaultActModelId: v.optional(v.string()),
    defaultImageModelId: v.optional(v.string()),
    defaultVideoModelId: v.optional(v.string()),
    defaultImageAspectRatio: v.optional(v.string()),
    defaultVideoAspectRatio: v.optional(v.string()),
    sendWithEnter: v.optional(v.boolean()),
    attachFilesToKnowledgeByDefault: v.optional(v.boolean()),
    onlyAllowZdrModels: v.optional(v.boolean()),
    dismissedZdrWarningGlobally: v.optional(v.boolean()),
    dismissedZdrWarningModelIds: v.optional(v.array(v.string())),
    enabledChatModelIds: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_userId', ['userId']),

  gatewayCatalogSnapshots: defineTable({
    key: v.string(),
    source: v.string(),
    modelsJson: v.string(),
    fetchedAt: v.number(),
    updatedAt: v.number(),
  }).index('by_key', ['key']),

  // Single source of truth for a user's subscription, tier, and current-period credit spend.
  // creditsUsed is the live accumulator (in cents, may include fractional cents)
  // mutated on every usage event.
  // currentPeriodStart/End are always set — on Stripe-backed subscriptions they come from
  // the webhook; on free tier they are set to now/+30d at account creation.
  subscriptions: defineTable({
    userId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    stripeQuantity: v.optional(v.number()),
    tier: v.union(v.literal('free'), v.literal('pro'), v.literal('max')),
    planKind: v.optional(v.union(v.literal('free'), v.literal('paid'))),
    planVersion: v.optional(v.union(v.literal('fixed_v1'), v.literal('variable_v2'))),
    planAmountCents: v.optional(v.number()),
    institutionalGrantCents: v.optional(v.number()),
    markupBasisPoints: v.optional(v.number()),
    status: v.union(
      v.literal('active'),
      v.literal('canceled'),
      v.literal('past_due'),
      v.literal('trialing')
    ),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    // Live credit accumulator for the current billing period (in cents, may
    // include fractional cents for Daytona runtime accrual).
    // Reset to 0 whenever currentPeriodStart rolls over.
    creditsUsed: v.optional(v.number()),
    autoTopUpEnabled: v.optional(v.boolean()),
    autoTopUpAmountCents: v.optional(v.number()),
    offSessionConsentAt: v.optional(v.number()),
    // User profile fields synced from the selected auth provider.
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    profilePictureUrl: v.optional(v.string()),
    lastLoginAt: v.optional(v.number()),
    /** Personalized empty-state prompts; refreshed daily (UTC) via /api/v1/chat-suggestions. */
    chatStarterPrompts: v.optional(v.array(v.string())),
    chatStarterDay: v.optional(v.string()),
    // Onboarding tour state
    hasSeenOnboarding: v.optional(v.boolean()),
    // Legacy fields kept only so older rows continue to validate during deploys.
    autoRefillEnabled: v.optional(v.boolean()),
    overlayStorageBytesUsed: v.optional(v.number()),
    fileBandwidthBytesUsed: v.optional(v.number()),
    fileBandwidthPeriodStart: v.optional(v.number()),
  }).index('by_userId', ['userId'])
    .index('by_email', ['email'])
    .index('by_stripeCustomerId', ['stripeCustomerId']),

  budgetTopUps: defineTable({
    userId: v.string(),
    stripeCustomerId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeInvoiceId: v.optional(v.string()),
    billingPeriodStart: v.number(),
    billingPeriodEnd: v.optional(v.number()),
    amountCents: v.number(),
    source: v.union(v.literal('manual'), v.literal('auto')),
    status: v.union(
      v.literal('pending'),
      v.literal('succeeded'),
      v.literal('failed'),
      v.literal('canceled'),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    errorMessage: v.optional(v.string()),
  })
    .index('by_userId_createdAt', ['userId', 'createdAt'])
    .index('by_userId_billingPeriodStart', ['userId', 'billingPeriodStart'])
    .index('by_paymentIntentId', ['stripePaymentIntentId'])
    .index('by_checkoutSessionId', ['stripeCheckoutSessionId']),

  // Webhook event deduplication. Stores processed Stripe event IDs so that a
  // duplicate delivery (or a replay from a compromised observability path)
  // is a no-op. TTL cleanup happens via a scheduled job that drops rows older
  // than 30 days.
  processedWebhookEvents: defineTable({
    provider: v.string(),
    eventId: v.string(),
    eventType: v.optional(v.string()),
    payloadHash: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal('processing'),
      v.literal('processed'),
      v.literal('failed'),
    )),
    attempt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
    processedAt: v.number(),
  })
    .index('by_provider_eventId', ['provider', 'eventId'])
    .index('by_processedAt', ['processedAt']),

  rateLimitWindows: defineTable({
    bucket: v.string(),
    bucketKey: v.string(),
    count: v.number(),
    resetAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_bucketKey', ['bucketKey'])
    .index('by_resetAt', ['resetAt']),

  apiIdempotencyKeys: defineTable({
    userId: v.string(),
    keyHash: v.string(),
    requestHash: v.string(),
    method: v.string(),
    path: v.string(),
    status: v.union(v.literal('processing'), v.literal('completed')),
    responseStatus: v.optional(v.number()),
    responseHeaders: v.optional(v.array(v.object({
      name: v.string(),
      value: v.string(),
    }))),
    responseBody: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_keyHash', ['keyHash'])
    .index('by_expiresAt', ['expiresAt'])
    .index('by_userId_createdAt', ['userId', 'createdAt']),

  serviceAuthReplayNonces: defineTable({
    jti: v.string(),
    subject: v.string(),
    method: v.string(),
    path: v.string(),
    expiresAt: v.number(),
    consumedAt: v.number(),
  })
    .index('by_jti', ['jti'])
    .index('by_expiresAt', ['expiresAt']),

  apiKeys: defineTable({
    keyHash: v.string(),
    name: v.optional(v.string()),
    userId: v.string(),
    scopes: v.array(v.union(
      v.literal('chat:read'),
      v.literal('chat:write'),
      v.literal('files:read'),
      v.literal('files:write'),
      v.literal('admin'),
    )),
    expiresAt: v.number(),
    createdAt: v.number(),
    createdBy: v.optional(v.string()),
    createdFromIp: v.optional(v.string()),
    lastUsedAt: v.optional(v.number()),
    lastUsedIp: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
    revokedReason: v.optional(v.string()),
  })
    .index('by_keyHash', ['keyHash'])
    .index('by_userId_createdAt', ['userId', 'createdAt'])
    .index('by_expiresAt', ['expiresAt'])
    .index('by_revokedAt', ['revokedAt']),

  // Append-only audit log: one row per billing period per user.
  // Written to on every usage batch for raw token counts and a credit snapshot.
  // Never read for enforcement — use subscriptions.creditsUsed for that.
  tokenUsage: defineTable({
    userId: v.string(),
    email: v.string(), // denormalized from subscriptions for easy dashboard filtering
    billingPeriodStart: v.string(), // ISO date string
    creditsUsed: v.optional(v.number()), // cents accumulated this period (audit copy, may be fractional)
    costAccrued: v.optional(v.number()), // legacy alias for creditsUsed
    inputTokens: v.number(),
    cachedInputTokens: v.number(),
    outputTokens: v.number()
  }).index('by_userId_period', ['userId', 'billingPeriodStart']),

  budgetReservations: defineTable({
    userId: v.string(),
    reservationId: v.string(),
    status: v.union(
      v.literal('reserved'),
      v.literal('finalized'),
      v.literal('released'),
      v.literal('reconcile_required'),
    ),
    kind: v.union(
      v.literal('ask'),
      v.literal('write'),
      v.literal('agent'),
      v.literal('embedding'),
      v.literal('transcription'),
      v.literal('generation'),
      v.literal('sandbox'),
    ),
    modelId: v.optional(v.string()),
    operationId: v.optional(v.string()),
    requestFingerprint: v.optional(v.string()),
    reservedCents: v.number(),
    finalizedCents: v.optional(v.number()),
    providerWorkStarted: v.optional(v.boolean()),
    providerWorkCompleted: v.optional(v.boolean()),
    errorMessage: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_reservationId', ['reservationId'])
    .index('by_userId_createdAt', ['userId', 'createdAt'])
    .index('by_status_createdAt', ['status', 'createdAt']),

  usageOperations: defineTable({
    userId: v.string(),
    operationId: v.string(),
    recorded: v.number(),
    createdAt: v.number(),
  })
    .index('by_operationId', ['operationId'])
    .index('by_userId_createdAt', ['userId', 'createdAt']),

  administrativePrincipals: defineTable({
    userId: v.string(),
    role: v.union(
      v.literal('admin'),
      v.literal('auditor'),
      v.literal('billing_admin'),
      v.literal('support'),
    ),
    grantedBy: v.optional(v.string()),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.string()),
  })
    .index('by_userId', ['userId'])
    .index('by_createdAt', ['createdAt']),

  authorizationRoles: defineTable({
    roleId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    capabilities: v.array(v.string()),
    isSystem: v.boolean(),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index('by_roleId', ['roleId'])
    .index('by_name', ['name'])
    .index('by_archivedAt', ['archivedAt']),

  authorizationGroups: defineTable({
    groupId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    source: v.union(v.literal('local'), v.literal('external')),
    externalId: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index('by_groupId', ['groupId'])
    .index('by_name', ['name'])
    .index('by_source_externalId', ['source', 'externalId'])
    .index('by_archivedAt', ['archivedAt']),

  authorizationGroupMemberships: defineTable({
    groupId: v.string(),
    userId: v.string(),
    source: v.union(v.literal('local'), v.literal('external')),
    createdAt: v.number(),
  })
    .index('by_groupId_userId', ['groupId', 'userId'])
    .index('by_groupId', ['groupId'])
    .index('by_userId', ['userId']),

  authorizationUserRoles: defineTable({
    userId: v.string(),
    roleId: v.string(),
    assignedBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_userId_roleId', ['userId', 'roleId'])
    .index('by_userId', ['userId'])
    .index('by_roleId', ['roleId']),

  authorizationGroupRoles: defineTable({
    groupId: v.string(),
    roleId: v.string(),
    assignedBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_groupId_roleId', ['groupId', 'roleId'])
    .index('by_groupId', ['groupId'])
    .index('by_roleId', ['roleId']),

  authorizationResourceGrants: defineTable({
    grantId: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    principalType: v.union(v.literal('user'), v.literal('group'), v.literal('role')),
    principalId: v.string(),
    accessRole: v.union(v.literal('viewer'), v.literal('editor'), v.literal('owner')),
    grantedBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_grantId', ['grantId'])
    .index('by_resource', ['resourceType', 'resourceId'])
    .index('by_principal', ['principalType', 'principalId', 'resourceType']),

  auditEvents: defineTable({
    eventId: v.string(),
    actorType: v.union(
      v.literal('user'),
      v.literal('api_key'),
      v.literal('service'),
      v.literal('system'),
    ),
    actorUserId: v.optional(v.string()),
    actorApiKeyId: v.optional(v.string()),
    action: v.string(),
    resourceType: v.string(),
    resourceId: v.optional(v.string()),
    outcome: v.union(v.literal('success'), v.literal('denied'), v.literal('failure')),
    requestId: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    metadataJson: v.string(),
    createdAt: v.number(),
  })
    .index('by_eventId', ['eventId'])
    .index('by_actorUserId_createdAt', ['actorUserId', 'createdAt'])
    .index('by_createdAt', ['createdAt']),

  daytonaWorkspaces: defineTable({
    userId: v.string(),
    sandboxId: v.string(),
    sandboxName: v.string(),
    volumeId: v.string(),
    volumeName: v.string(),
    tier: v.union(v.literal('pro'), v.literal('max')),
    state: v.union(
      v.literal('provisioning'),
      v.literal('started'),
      v.literal('stopped'),
      v.literal('archived'),
      v.literal('error'),
      v.literal('missing'),
    ),
    resourceProfile: v.union(v.literal('pro'), v.literal('max')),
    mountPath: v.string(),
    lastMeteredAt: v.optional(v.number()),
    lastKnownStartedAt: v.optional(v.number()),
    lastKnownStoppedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_sandboxId', ['sandboxId']),

  daytonaUsageLedger: defineTable({
    userId: v.string(),
    sandboxId: v.string(),
    tier: v.union(v.literal('pro'), v.literal('max')),
    resourceProfile: v.union(v.literal('pro'), v.literal('max')),
    startedAt: v.number(),
    endedAt: v.number(),
    durationSeconds: v.number(),
    cpu: v.number(),
    memoryGiB: v.number(),
    diskGiB: v.number(),
    costUsd: v.number(),
    costCents: v.number(),
    reason: v.union(
      v.literal('start'),
      v.literal('task'),
      v.literal('stop'),
      v.literal('archive'),
      v.literal('resize'),
      v.literal('reconcile'),
    ),
    createdAt: v.number(),
  })
    .index('by_userId_createdAt', ['userId', 'createdAt'])
    .index('by_sandboxId_createdAt', ['sandboxId', 'createdAt']),

  /** One row per tool invocation (audit / cost-class tracking for chat tools). */
  toolInvocations: defineTable({
    userId: v.string(),
    toolId: v.string(),
    mode: v.union(v.literal('ask'), v.literal('act')),
    modelId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    success: v.boolean(),
    durationMs: v.optional(v.number()),
    costBucket: v.union(
      v.literal('perplexity'),
      v.literal('image'),
      v.literal('video'),
      v.literal('browser'),
      v.literal('daytona'),
      v.literal('composio'),
      v.literal('internal'),
    ),
    providerCostCents: v.optional(v.number()),
    billableCostCents: v.optional(v.number()),
    pricingVersion: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_userId_createdAt', ['userId', 'createdAt'])
    .index('by_userId_toolId', ['userId', 'toolId'])
    .index('by_conversationId_createdAt', ['conversationId', 'createdAt'])
    .index('by_turnId_createdAt', ['turnId', 'createdAt']),

  // Daily counters used exclusively for free-tier weekly limit enforcement.
  dailyUsage: defineTable({
    userId: v.string(),
    date: v.string(), // YYYY-MM-DD format
    askCount: v.number(),
    agentCount: v.number(),
    writeCount: v.number(),
    transcriptionSeconds: v.optional(v.number()),
    voiceChatCount: v.optional(v.number()),
    noteBrowserCount: v.optional(v.number()),
    browserSearchCount: v.optional(v.number()),
    memoryExtractionCount: v.optional(v.number()),
    indexingChunks: v.optional(v.number()),
    indexingBytes: v.optional(v.number()),
  }).index('by_userId_date', ['userId', 'date']),

  // Short-lived session transfer tokens for desktop app auth linking
  sessionTransferTokens: defineTable({
    tokenHash: v.optional(v.string()),
    token: v.optional(v.string()),
    codeChallenge: v.optional(v.string()),
    data: v.string(), // JSON-encoded auth data
    expiresAt: v.number(),
  })
    .index('by_tokenHash', ['tokenHash']),

  projects: defineTable({
    userId: v.string(),
    clientId: v.optional(v.string()),
    name: v.string(),
    instructions: v.optional(v.string()),
    parentId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_clientId', ['userId', 'clientId'])
    .index('by_userId_updatedAt', ['userId', 'updatedAt']),

  skills: defineTable({
    userId: v.string(),
    name: v.string(),
    description: v.string(),
    instructions: v.string(),
    enabled: v.optional(v.boolean()),
    projectId: v.optional(v.string()),
    version: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_userId', ['userId']).index('by_projectId', ['projectId']),

  automations: defineTable({
    userId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    instructions: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    schedule: v.optional(v.object({
      kind: v.union(
        v.literal('interval'),
        v.literal('daily'),
        v.literal('weekly'),
        v.literal('monthly'),
      ),
      intervalMinutes: v.optional(v.number()),
      minuteUTC: v.optional(v.number()),
      hourUTC: v.optional(v.number()),
      dayOfWeekUTC: v.optional(v.number()),
      dayOfMonthUTC: v.optional(v.number()),
    })),
    timezone: v.optional(v.string()),
    nextRunAt: v.optional(v.number()),
    lastRunAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    projectId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    graphSource: v.optional(v.string()),
    sourceConversationId: v.optional(v.id('conversations')),
    concurrencyPolicy: v.optional(v.union(v.literal('skip'), v.literal('queue'))),
    // Legacy automation fields kept so existing production rows continue to validate.
    conversationId: v.optional(v.id('conversations')),
    failureStreak: v.optional(v.number()),
    title: v.optional(v.string()),
    instructionsMarkdown: v.optional(v.string()),
    lastRunStatus: v.optional(v.string()),
    mode: v.optional(v.union(v.literal('ask'), v.literal('act'))),
    readinessMessage: v.optional(v.string()),
    readinessState: v.optional(v.string()),
    skillId: v.optional(v.id('skills')),
    sourceType: v.optional(v.union(v.literal('skill'), v.literal('inline'))),
    status: v.optional(v.union(v.literal('active'), v.literal('paused'), v.literal('archived'))),
    scheduleKind: v.optional(v.union(
      v.literal('once'),
      v.literal('daily'),
      v.literal('weekdays'),
      v.literal('weekly'),
      v.literal('monthly'),
    )),
    scheduleConfig: v.optional(v.object({
      localTime: v.optional(v.string()),
      weekdays: v.optional(v.array(v.number())),
      dayOfMonth: v.optional(v.number()),
      onceAt: v.optional(v.number()),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_updatedAt', ['userId', 'updatedAt'])
    .index('by_userId_enabled', ['userId', 'enabled'])
    .index('by_enabled_nextRunAt', ['enabled', 'nextRunAt'])
    .index('by_projectId', ['projectId']),

  automationRuns: defineTable({
    automationId: v.id('automations'),
    userId: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('succeeded'),
      v.literal('failed'),
      v.literal('cancel_requested'),
      v.literal('cancelled'),
      v.literal('skipped'),
      v.literal('dead_letter'),
    ),
    scheduledFor: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    conversationId: v.optional(v.id('conversations')),
    turnId: v.optional(v.string()),
    error: v.optional(v.string()),
    // Legacy run fields kept so existing production rows continue to validate.
    attemptNumber: v.optional(v.number()),
    assistantMessage: v.optional(v.string()),
    assistantPersisted: v.optional(v.boolean()),
    durationMs: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    executor: v.optional(v.any()),
    failureStage: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
    lastHeartbeatAt: v.optional(v.number()),
    mode: v.optional(v.union(v.literal('ask'), v.literal('act'))),
    modelId: v.optional(v.string()),
    promptSnapshot: v.optional(v.string()),
    readinessState: v.optional(v.string()),
    requestId: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
    retryOfRunId: v.optional(v.id('automationRuns')),
    stage: v.optional(v.string()),
    triggerSource: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index('by_automationId_createdAt', ['automationId', 'createdAt'])
    .index('by_automationId_status', ['automationId', 'status'])
    .index('by_status_scheduledFor', ['status', 'scheduledFor'])
    .index('by_userId_createdAt', ['userId', 'createdAt']),

  mcpServers: defineTable({
    userId: v.string(),
    projectId: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    transport: v.union(v.literal('sse'), v.literal('streamable-http')),
    url: v.string(),
    enabled: v.boolean(),
    authType: v.union(v.literal('none'), v.literal('bearer'), v.literal('header')),
    authConfig: v.optional(
      v.object({
        bearerToken: v.optional(v.string()),
        headerName: v.optional(v.string()),
        headerValue: v.optional(v.string()),
      })
    ),
    encryptedAuthConfig: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
    defaultToolPolicy: v.optional(v.union(
      v.literal('allow'),
      v.literal('approval_required'),
      v.literal('deny'),
    )),
    toolPolicies: v.optional(v.record(
      v.string(),
      v.union(v.literal('allow'), v.literal('approval_required'), v.literal('deny')),
    )),
    toolCatalog: v.optional(
      v.array(
        v.object({
          name: v.string(),
          description: v.optional(v.string()),
          inputSchema: v.optional(v.any()),
        }),
      ),
    ),
    toolCatalogUpdatedAt: v.optional(v.number()),
    toolCatalogError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_enabled', ['userId', 'enabled'])
    .index('by_projectId', ['projectId']),

  mcpToolExecutions: defineTable({
    userId: v.string(),
    projectId: v.optional(v.string()),
    mcpServerId: v.id('mcpServers'),
    toolName: v.string(),
    argumentsHash: v.string(),
    policyDecision: v.union(
      v.literal('allow'),
      v.literal('approval_required'),
      v.literal('deny'),
    ),
    status: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('denied')),
    conversationId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_userId_createdAt', ['userId', 'createdAt'])
    .index('by_mcpServerId_createdAt', ['mcpServerId', 'createdAt'])
    .index('by_projectId', ['projectId']),

  conversations: defineTable({
    userId: v.string(),
    clientId: v.optional(v.string()),
    title: v.string(),
    projectId: v.optional(v.string()),
    lastModified: v.number(),
    updatedAt: v.optional(v.number()),
    createdAt: v.number(),
    lastMode: v.union(v.literal('ask'), v.literal('act')),
    askModelIds: v.array(v.string()),
    actModelId: v.string(),
    deletedAt: v.optional(v.number()),
    shareToken: v.optional(v.string()),
    shareVisibility: v.optional(v.union(v.literal('private'), v.literal('public'))),
    sharedAt: v.optional(v.number()),
    isAutomation: v.optional(v.boolean()),
  }).index('by_userId', ['userId'])
    .index('by_userId_clientId', ['userId', 'clientId'])
    .index('by_userId_lastModified', ['userId', 'lastModified'])
    .index('by_userId_updatedAt', ['userId', 'updatedAt'])
    .index('by_projectId', ['projectId'])
    .index('by_shareToken', ['shareToken']),

  conversationMessages: defineTable({
    conversationId: v.id('conversations'),
    userId: v.string(),
    turnId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant')),
    mode: v.union(v.literal('ask'), v.literal('act')),
    content: v.string(),
    contentType: v.union(v.literal('text'), v.literal('image'), v.literal('video')),
    parts: v.optional(
      v.array(
        v.union(
          v.object({
            type: v.literal('data'),
            id: v.string(),
            dataType: v.literal('overlay.generated_ui'),
            data: v.union(
              v.object({
                version: v.literal(1),
                kind: v.literal('draft.text'),
                title: v.optional(v.string()),
                body: v.string(),
                format: v.optional(v.union(v.literal('plain'), v.literal('markdown'))),
              }),
              v.object({
                version: v.literal(1),
                kind: v.literal('draft.email'),
                subject: v.string(),
                body: v.string(),
                to: v.optional(v.array(v.string())),
                cc: v.optional(v.array(v.string())),
                bcc: v.optional(v.array(v.string())),
                provider: v.optional(v.literal('gmail')),
                variants: v.optional(v.array(v.object({
                  id: v.string(),
                  label: v.string(),
                  subject: v.optional(v.string()),
                  body: v.string(),
                }))),
              }),
              v.object({
                version: v.literal(1),
                kind: v.literal('connector.connect'),
                serviceName: v.string(),
                slug: v.optional(v.string()),
                description: v.optional(v.string()),
                connectUrl: v.optional(v.string()),
                connected: v.optional(v.boolean()),
              }),
            ),
            transient: v.optional(v.boolean()),
          }),
          v.object({
            type: v.literal('tool-invocation'),
            toolInvocation: v.object({
              toolCallId: v.optional(v.string()),
              toolName: v.string(),
              state: v.optional(v.string()),
              toolInput: v.optional(v.any()),
              toolOutput: v.optional(v.any()),
            }),
          }),
          v.object({
            type: v.string(),
            text: v.optional(v.string()),
            url: v.optional(v.string()),
            mediaType: v.optional(v.string()),
            /** Optional display name for file parts */
            fileName: v.optional(v.string()),
            state: v.optional(v.string()),
          }),
        ),
      ),
    ),
    modelId: v.optional(v.string()),
    variantIndex: v.optional(v.number()),
    tokens: v.optional(v.object({ input: v.number(), output: v.number() })),
    /** User message: optional thread reply target (assistant / exchange turn). */
    replyToTurnId: v.optional(v.string()),
    replySnippet: v.optional(v.string()),
    routedModelId: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal('generating'),
      v.literal('completed'),
      v.literal('error'),
    )),
    updatedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index('by_conversationId', ['conversationId'])
    .index('by_userId', ['userId'])
    .index('by_conversationId_createdAt', ['conversationId', 'createdAt'])
    .index('by_conversationId_status_updatedAt', ['conversationId', 'status', 'updatedAt'])
    .index('by_status_updatedAt', ['status', 'updatedAt']),

  conversationMessageDeltas: defineTable({
    conversationId: v.id('conversations'),
    messageId: v.id('conversationMessages'),
    userId: v.string(),
    textDelta: v.optional(v.string()),
    newParts: v.optional(
      v.array(
        v.union(
          v.object({
            type: v.literal('data'),
            id: v.string(),
            dataType: v.literal('overlay.generated_ui'),
            data: v.union(
              v.object({
                version: v.literal(1),
                kind: v.literal('draft.text'),
                title: v.optional(v.string()),
                body: v.string(),
                format: v.optional(v.union(v.literal('plain'), v.literal('markdown'))),
              }),
              v.object({
                version: v.literal(1),
                kind: v.literal('draft.email'),
                subject: v.string(),
                body: v.string(),
                to: v.optional(v.array(v.string())),
                cc: v.optional(v.array(v.string())),
                bcc: v.optional(v.array(v.string())),
                provider: v.optional(v.literal('gmail')),
                variants: v.optional(v.array(v.object({
                  id: v.string(),
                  label: v.string(),
                  subject: v.optional(v.string()),
                  body: v.string(),
                }))),
              }),
              v.object({
                version: v.literal(1),
                kind: v.literal('connector.connect'),
                serviceName: v.string(),
                slug: v.optional(v.string()),
                description: v.optional(v.string()),
                connectUrl: v.optional(v.string()),
                connected: v.optional(v.boolean()),
              }),
            ),
            transient: v.optional(v.boolean()),
          }),
          v.object({
            type: v.literal('tool-invocation'),
            toolInvocation: v.object({
              toolCallId: v.optional(v.string()),
              toolName: v.string(),
              state: v.optional(v.string()),
              toolInput: v.optional(v.any()),
              toolOutput: v.optional(v.any()),
            }),
          }),
          v.object({
            type: v.string(),
            text: v.optional(v.string()),
            url: v.optional(v.string()),
            mediaType: v.optional(v.string()),
            fileName: v.optional(v.string()),
            state: v.optional(v.string()),
          }),
        ),
      ),
    ),
    createdAt: v.number(),
  }).index('by_conversationId', ['conversationId'])
    .index('by_messageId', ['messageId'])
    .index('by_userId', ['userId'])
    .index('by_createdAt', ['createdAt']),

  conversationContextSummaries: defineTable({
    conversationId: v.id('conversations'),
    userId: v.string(),
    scope: v.string(),
    summary: v.string(),
    summarizedThroughMessageId: v.optional(v.string()),
    summarizedThroughCreatedAt: v.optional(v.number()),
    sourceMessageCount: v.number(),
    sourceEstimatedTokens: v.number(),
    summaryEstimatedTokens: v.number(),
    contextWindow: v.number(),
    targetModelId: v.string(),
    summarizerModelId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_conversationId_scope', ['conversationId', 'scope'])
    .index('by_userId_updatedAt', ['userId', 'updatedAt']),

  notes: defineTable({
    userId: v.string(),
    clientId: v.optional(v.string()),
    title: v.string(),
    icon: v.optional(v.string()),
    content: v.string(),
    tags: v.array(v.string()),
    projectId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  }).index('by_userId', ['userId'])
    .index('by_userId_clientId', ['userId', 'clientId'])
    .index('by_userId_updatedAt', ['userId', 'updatedAt'])
    .index('by_projectId', ['projectId']),

  memories: defineTable({
    userId: v.string(),
    clientId: v.optional(v.string()),
    content: v.string(),
    source: v.union(v.literal('chat'), v.literal('note'), v.literal('manual')),
    type: v.optional(
      v.union(
        v.literal('preference'),
        v.literal('fact'),
        v.literal('project'),
        v.literal('decision'),
        v.literal('agent'),
      ),
    ),
    importance: v.optional(v.number()),
    projectId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    noteId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    actor: v.optional(v.union(v.literal('user'), v.literal('agent'))),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_clientId', ['userId', 'clientId'])
    .index('by_userId_updatedAt', ['userId', 'updatedAt']),

  knowledgeBases: defineTable({
    knowledgeBaseId: v.string(),
    ownerUserId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    kind: v.union(v.literal('personal'), v.literal('organization')),
    status: v.union(v.literal('active'), v.literal('archived')),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index('by_knowledgeBaseId', ['knowledgeBaseId'])
    .index('by_ownerUserId_status', ['ownerUserId', 'status'])
    .index('by_kind_status', ['kind', 'status']),

  knowledgeSources: defineTable({
    sourceId: v.string(),
    ownerUserId: v.string(),
    kind: v.union(v.literal('file'), v.literal('note'), v.literal('memory'), v.literal('text')),
    sourceRef: v.optional(v.string()),
    title: v.string(),
    mimeType: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    status: v.union(
      v.literal('pending'),
      v.literal('extracting'),
      v.literal('indexing'),
      v.literal('ready'),
      v.literal('failed'),
      v.literal('deleting'),
    ),
    statusMessage: v.optional(v.string()),
    metadata: v.any(),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index('by_sourceId', ['sourceId'])
    .index('by_ownerUserId_status', ['ownerUserId', 'status'])
    .index('by_owner_kind_ref', ['ownerUserId', 'kind', 'sourceRef']),

  knowledgeSourceVersions: defineTable({
    sourceVersionId: v.string(),
    sourceId: v.string(),
    version: v.number(),
    contentHash: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('extracting'),
      v.literal('indexing'),
      v.literal('ready'),
      v.literal('failed'),
      v.literal('deleting'),
    ),
    metadata: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_sourceVersionId', ['sourceVersionId'])
    .index('by_sourceId_version', ['sourceId', 'version'])
    .index('by_sourceId_contentHash', ['sourceId', 'contentHash']),

  knowledgeBaseSources: defineTable({
    knowledgeBaseId: v.string(),
    sourceId: v.string(),
    addedBy: v.optional(v.string()),
    enabled: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_base_source', ['knowledgeBaseId', 'sourceId'])
    .index('by_knowledgeBaseId', ['knowledgeBaseId'])
    .index('by_sourceId', ['sourceId']),

  knowledgeBaseConversations: defineTable({
    knowledgeBaseId: v.string(),
    conversationId: v.string(),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_conversationId', ['conversationId'])
    .index('by_knowledgeBaseId', ['knowledgeBaseId']),

  // Searchable chunks for hybrid vector + full-text retrieval (files + memories).
  knowledgeChunks: defineTable({
    userId: v.string(),
    projectId: v.optional(v.string()),
    sourceKind: v.union(v.literal('file'), v.literal('memory')),
    sourceId: v.string(),
    knowledgeSourceId: v.optional(v.string()),
    knowledgeSourceVersionId: v.optional(v.string()),
    chunkIndex: v.number(),
    startOffset: v.number(),
    text: v.string(),
    title: v.optional(v.string()),
  })
    .index('by_source', ['sourceKind', 'sourceId'])
    .index('by_knowledgeSourceId', ['knowledgeSourceId'])
    .index('by_knowledgeSourceVersionId', ['knowledgeSourceVersionId'])
    .index('by_userId', ['userId'])
    .searchIndex('search_text', {
      searchField: 'text',
      filterFields: ['userId', 'sourceKind'],
    }),

  // Embeddings stored separately so routine reads avoid loading large vectors.
  knowledgeChunkEmbeddings: defineTable({
    chunkId: v.id('knowledgeChunks'),
    userId: v.string(),
    sourceKind: v.union(v.literal('file'), v.literal('memory')),
    embedding: v.array(v.float64()),
  })
    .index('by_chunkId', ['chunkId'])
    .index('by_userId', ['userId'])
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: 1536,
      filterFields: ['userId', 'sourceKind'],
    }),

  // Generated images and videos from Chat and Agent sessions.
  outputs: defineTable({
    userId: v.string(),
    type: v.union(
      v.literal('image'),
      v.literal('video'),
      v.literal('audio'),
      v.literal('document'),
      v.literal('archive'),
      v.literal('code'),
      v.literal('text'),
      v.literal('other'),
    ),
    source: v.optional(
      v.union(
        v.literal('image_generation'),
        v.literal('video_generation'),
        v.literal('sandbox'),
      ),
    ),
    status: v.union(v.literal('pending'), v.literal('completed'), v.literal('failed')),
    prompt: v.string(),
    modelId: v.string(),
    storageId: v.optional(v.id('_storage')),
    r2Key: v.optional(v.string()),
    url: v.optional(v.string()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    metadata: v.optional(v.any()),
    fileId: v.optional(v.id('files')),
    conversationId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index('by_userId', ['userId'])
    .index('by_userId_createdAt', ['userId', 'createdAt'])
    .index('by_conversationId', ['conversationId'])
    .index('by_turnId', ['turnId']),

  // Knowledge base and project files. Text content is stored in `content`.
  // Binary originals (images, PDFs, etc.) use Cloudflare R2 via `r2Key`; served via /api/v1/files/[id]/content.
  // `storageId` is legacy Convex File Storage only (no longer written by the app).
  r2UploadIntents: defineTable({
    userId: v.string(),
    r2Key: v.string(),
    declaredSizeBytes: v.number(),
    actualSizeBytes: v.optional(v.number()),
    mimeType: v.optional(v.string()),
    status: v.union(
      v.literal('pending'),
      v.literal('finalized'),
      v.literal('expired'),
    ),
    fileId: v.optional(v.id('files')),
    createdAt: v.number(),
    expiresAt: v.number(),
    finalizedAt: v.optional(v.number()),
    expiredAt: v.optional(v.number()),
  })
    .index('by_r2Key', ['r2Key'])
    .index('by_userId_status_expiresAt', ['userId', 'status', 'expiresAt']),

  files: defineTable({
    userId: v.string(),
    clientId: v.optional(v.string()),
    name: v.string(),
    type: v.union(v.literal('file'), v.literal('folder')),
    kind: v.optional(v.union(
      v.literal('folder'),
      v.literal('note'),
      v.literal('upload'),
      v.literal('output'),
    )),
    parentId: v.optional(v.string()),
    content: v.optional(v.string()),
    textContent: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    r2Key: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    duplicateOfFileId: v.optional(v.id('files')),
    indexable: v.optional(v.boolean()),
    indexStatus: v.optional(v.union(
      v.literal('pending'),
      v.literal('indexed'),
      v.literal('skipped'),
      v.literal('failed'),
    )),
    indexedAt: v.optional(v.number()),
    indexError: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    prompt: v.optional(v.string()),
    outputType: v.optional(v.string()),
    outputSource: v.optional(v.union(
      v.literal('image_generation'),
      v.literal('video_generation'),
      v.literal('browser'),
      v.literal('sandbox'),
    )),
    outputStatus: v.optional(v.union(
      v.literal('pending'),
      v.literal('completed'),
      v.literal('failed'),
    )),
    outputUrl: v.optional(v.string()),
    outputMetadata: v.optional(v.any()),
    outputErrorMessage: v.optional(v.string()),
    outputCompletedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    legacyNoteId: v.optional(v.id('notes')),
    legacyOutputId: v.optional(v.id('outputs')),
    projectId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    shareToken: v.optional(v.string()),
    shareVisibility: v.optional(v.union(v.literal('private'), v.literal('public'))),
    sharedAt: v.optional(v.number()),
  }).index('by_userId', ['userId'])
    .index('by_userId_clientId', ['userId', 'clientId'])
    .index('by_userId_contentHash', ['userId', 'contentHash'])
    .index('by_duplicateOfFileId', ['duplicateOfFileId'])
    .index('by_projectId', ['projectId'])
    .index('by_parentId', ['parentId'])
    .index('by_legacyNoteId', ['legacyNoteId'])
    .index('by_legacyOutputId', ['legacyOutputId'])
    .index('by_outputExpiry', ['kind', 'outputStatus', 'expiresAt'])
    .index('by_shareToken', ['shareToken']),

  webhookSubscriptions: defineTable({
    userId: v.string(),
    url: v.string(),
    secret: v.string(),
    events: v.array(v.string()),
    enabled: v.boolean(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_enabled', ['userId', 'enabled']),

  webhookDeliveries: defineTable({
    userId: v.string(),
    subscriptionId: v.id('webhookSubscriptions'),
    eventId: v.string(),
    eventType: v.string(),
    payloadJson: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('delivering'),
      v.literal('delivered'),
      v.literal('failed'),
      v.literal('dead'),
    ),
    attemptCount: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    lastStatusCode: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_status_nextAttemptAt', ['status', 'nextAttemptAt'])
    .index('by_subscriptionId_eventId', ['subscriptionId', 'eventId'])
    .index('by_userId_createdAt', ['userId', 'createdAt']),
})
