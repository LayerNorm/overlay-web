import 'server-only'

import type { ModelMessage, StepResult, ToolSet, UIMessage } from 'ai'
import type { CapabilityCheck } from '@overlay/app-core'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { WorkspaceAccess } from '@overlay/workspace-contracts'
import { OVERLAY_TOOL_IDS } from '@overlay/tools-core'
import { getOverlayServerContext } from '@/server/bootstrap'
import { convertToModelMessages, generateText } from '@/server/ai/sdk'
import { getGatewayModelId, getLanguageModel } from '@/server/ai/model-runtime'
import { getModel } from '@/shared/ai/gateway/model-data'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import {
  DEFAULT_MODEL_ID,
  FREE_TIER_DEFAULT_MODEL_ID,
} from '@/shared/ai/gateway/model-types'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import { meterAutomationWorkflowRun } from '@/server/billing/automation-workflow-billing'
import { resolveBillingPayer } from '@/server/billing/billing-runtime'
import { providerRequestFingerprint } from '@/server/billing/ServerProviderUsageMeter'
import {
  calculateProviderCostMicros,
  observeWorkflowRunMetrics,
  summarizeAgentToolMetrics,
} from '@/server/conversations/agent-run-metrics'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { describePersonalChatWorkTools } from '@/server/conversations/personal-chat-work-tools'
import {
  actContextService,
  actEntitlementService,
  actMessagePersistenceService,
  actUsageBudgetService,
} from '@/server/conversations/http'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import { buildSecondarySystemPromptExtension } from '@/server/agent/operator-system-prompt'
import {
  ACT_KNOWLEDGE_TOOLS_NOTE_NO_WEB,
  ACT_KNOWLEDGE_WEB_TOOLS_NOTE,
  ACT_PAID_PLAN_ACT_TOOLS_REALITY,
  FREE_TIER_NO_PAID_AGENT_CAPABILITIES,
  MEMORY_SAVE_PROTOCOL,
  cloneMessagesWithIndexedFileHint,
  indexedFilesSystemNote,
  indexedFilesSystemNotePreloaded,
} from '@/server/agent/knowledge-agent-instructions'
import { MATH_FORMAT_INSTRUCTION } from '@/shared/markdown/math-format-instructions'
import { TABLE_FORMAT_INSTRUCTION } from '@/shared/markdown/markdown-table-instructions'
import { buildActAgentInstructions } from '@/server/app-api/v1/conversations/act/instructions'
import {
  MAX_ACT_OUTPUT_TOKENS_PER_STEP,
  resolveEffectiveActModelId,
} from '@/server/app-api/v1/conversations/act/route-helpers'
import {
  authorizeActRequest,
  resolveProjectPreferredModelId,
} from '@/server/app-api/v1/conversations/act/turn-authorization'
import {
  prepareActTooling,
  preloadActExternalToolTasks,
} from '@/server/app-api/v1/conversations/act/tooling'
import { filterCatalogResources } from '@/server/authorization'
import {
  classifyMediaToolIntentForTurn,
  mayNeedMediaGenerationTools,
} from '@/server/tools/media-tool-intent'
import { parseMentionTokens } from '@/shared/knowledge/mention-tokens'
import {
  buildAutomationSystemPrompt,
  buildAutomationUserMessage,
} from '@/shared/automations/automation-prompts'
import type {
  PersonalChatWorkToolDefinition,
  PersonalChatWorkToolingContext,
} from '@/shared/agents/personal-chat-work'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
import { getBaseUrl } from '@/server/web/app-url'
import { automationService } from './http'

/**
 * Normalized input for one durable automation turn. Both the one-shot run
 * workflow and the scheduling workflow's per-iteration call converge here.
 * Everything on it must stay JSON-serializable — it crosses workflow
 * step boundaries.
 */
export type AutomationAgentTurnInput = {
  automationId?: string
  /** Present for manual "run now" executions backed by an automation_runs row. */
  runId?: string
  userId: string
  name: string
  description?: string
  instructions: string
  projectId?: string
  modelId?: string
  conversationId?: string
  turnId: string
  scheduledFor: number
  workspaceId?: string
}

/**
 * The serializable plan produced by `prepareAutomationAgentTurn`. It carries
 * everything the in-workflow `WorkflowAgent` needs so no request-scoped state
 * has to leak across the durable boundary.
 */
export type AutomationAgentTurnPlan = {
  conversationId: string
  effectiveModelId: string
  gatewayModelId: string
  instructions: string
  messages: ModelMessage[]
  paid: boolean
  reservationId: string | null
  sourceCitations?: SourceCitationMap
  toolDefinitions: PersonalChatWorkToolDefinition[]
  toolingContext: PersonalChatWorkToolingContext
}

/**
 * Raised for failures the caller should treat as terminal for this turn —
 * denials, missing configuration, or an unroutable model — so the workflow
 * can mark the run failed without retrying a hopeless step forever.
 */
export class AutomationTurnError extends Error {
  constructor(
    message: string,
    readonly statusCode = 500,
    readonly payload?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AutomationTurnError'
  }
}

/**
 * Durable agent turns can only call models the AI Gateway can serve — the
 * workflow step resolves `gateway.languageModel(<id>)` and there is no way to
 * smuggle a constructed LanguageModel (BYOK, OpenRouter, NVIDIA NIM) across
 * the step boundary. Fail fast with an actionable message instead of a
 * cryptic gateway 404 mid-run.
 */
function assertDurableAutomationModel(modelId: string): void {
  if (isByokModelId(modelId)) {
    throw new AutomationTurnError(
      `Model ${modelId} uses a personal provider key, which cannot run inside a durable automation. Pick a hosted model in the automation settings.`,
      400,
      { error: 'model_not_supported_for_durable_run' },
    )
  }
  const catalogModel = getModel(modelId)
  if (catalogModel && (catalogModel.provider === 'openrouter' || catalogModel.provider === 'nvidia')) {
    throw new AutomationTurnError(
      `Model ${modelId} is served by ${catalogModel.provider}, which durable automation runs cannot reach. Pick an AI Gateway model in the automation settings.`,
      400,
      { error: 'model_not_supported_for_durable_run' },
    )
  }
  try {
    getGatewayModelId(modelId)
  } catch (_error) {
    throw new AutomationTurnError(
      `Model ${modelId} is not a known AI Gateway model. Pick a different model in the automation settings.`,
      400,
      { error: 'model_not_supported_for_durable_run' },
    )
  }
}

/**
 * Create (or reuse) the conversation an automation turn writes into, bound to
 * the same workspace the BFF would resolve for the acting user.
 */
export async function ensureAutomationConversation(
  input: AutomationAgentTurnInput,
): Promise<{ conversationId: string; workspaceId: string }> {
  const overlayContext = getOverlayServerContext()
  const workspace = await overlayContext.workspaceService.resolveActiveWorkspace(
    input.userId,
    input.workspaceId,
  )
  if (input.conversationId) {
    return { conversationId: input.conversationId, workspaceId: workspace.workspace.id }
  }
  const conversationId = await overlayContext.appData.repositories.conversations
    .createConversation({
      userId: input.userId,
      title: `Automation: ${input.name || 'Untitled'}`,
      projectId: input.projectId,
      askModelIds: [input.modelId || DEFAULT_MODEL_ID],
      actModelId: input.modelId || DEFAULT_MODEL_ID,
      lastMode: 'act',
      isAutomation: true,
      workspaceId: workspace.workspace.id,
    })
  if (!conversationId) {
    throw new AutomationTurnError('Failed to create automation conversation')
  }
  return {
    conversationId: String(conversationId),
    workspaceId: workspace.workspace.id,
  }
}

/**
 * Replicates the act route's request preamble inside a durable step:
 * entitlement gating, workflow-step metering, billing payer, model policy,
 * catalog authorization, user-message persistence, context assembly
 * (history, memory, mentions, skills, project instructions), tool
 * construction, instruction assembly, and the turn-level usage reservation.
 */
export async function prepareAutomationAgentTurn(
  input: AutomationAgentTurnInput & { conversationId: string; workspaceId: string },
): Promise<AutomationAgentTurnPlan> {
  const overlayContext = getOverlayServerContext()
  const isPostgresAppData = overlayContext.appDataCapabilities.provider === 'postgres'
  const userId = input.userId
  const serverSecret = getInternalApiSecret()
  const cid = asConversationId(input.conversationId)
  const billingWorkspaceId = input.workspaceId

  const preferredProjectModelId = await resolveProjectPreferredModelId({
    conversationId: cid,
    projectId: input.projectId,
    userId,
  })
  const effectiveModelId = resolveEffectiveActModelId(input.modelId ?? preferredProjectModelId)
  assertDurableAutomationModel(effectiveModelId)

  const billingProgrammaticSubjectId = `automation:${input.automationId ?? input.runId ?? input.turnId}`
  const requestIdempotencyKey = `automation:${input.runId ?? input.automationId ?? 'turn'}:${input.turnId}`
  const requestFingerprint = providerRequestFingerprint({
    automationId: input.automationId,
    runId: input.runId,
    turnId: input.turnId,
    userId,
  })

  const { paid, runtimeEntitlements } = await actEntitlementService.gateModelAccess({
    effectiveModelId,
    programmaticSubjectId: billingProgrammaticSubjectId,
    userId,
    workspaceId: billingWorkspaceId,
  })

  const workflowMeter = await meterAutomationWorkflowRun({
    entitlements: runtimeEntitlements,
    idempotencyKey: requestIdempotencyKey,
    programmaticSubjectId: billingProgrammaticSubjectId,
    requestFingerprint,
    userId,
    workspaceId: billingWorkspaceId,
  })
  if (!workflowMeter.ok) {
    throw new AutomationTurnError(
      typeof workflowMeter.payload?.message === 'string'
        ? workflowMeter.payload.message
        : 'Automation workflow metering was denied.',
      workflowMeter.status,
      workflowMeter.payload,
    )
  }

  const resolvedBillingPayer = await resolveBillingPayer({
    programmaticSubjectId: billingProgrammaticSubjectId,
    userId,
    workspaceId: billingWorkspaceId,
  })

  const authorizedModelIds = await resolveAuthorizedModelIds({ entitlements: runtimeEntitlements })
  if (!authorizedModelIds.chat.has(effectiveModelId)) {
    throw new AutomationTurnError(
      `Model ${effectiveModelId} is not allowed by the server model policy.`,
      403,
      { error: 'model_not_allowed' },
    )
  }

  const mentions = parseMentionTokens(input.instructions)
    .map((mention) => ({ type: mention.type, id: mention.id, name: mention.name || mention.id }))
  const memoryEnabled = true

  // The durable turn re-runs the act route's catalog authorization under a
  // synthetic service-auth context — subject resolution keys off auth.userId.
  const workspaceAccess: WorkspaceAccess = await overlayContext.workspaceService
    .resolveActiveWorkspace(userId, billingWorkspaceId)
  const routeContext: AppApiRouteContext = {
    params: Promise.resolve({}),
    auth: { userId, accessToken: '', authType: 'service' },
    parsedQuery: {},
    parsedJson: { automationId: input.automationId },
    parsedFormData: null,
    capabilities: {} as CapabilityCheck,
    appDataCapabilities: overlayContext.appDataCapabilities,
    requestFingerprint,
    requestIdempotencyKey,
    workspace: workspaceAccess,
  }
  const denied = await authorizeActRequest({
    authorization: overlayContext.authorizationService,
    context: routeContext,
    effectiveModelId,
    memoryEnabled,
    mentions,
    requestedToolIds: [],
  })
  if (denied) {
    const payload = await denied.json().catch((_error) => ({})) as Record<string, unknown>
    throw new AutomationTurnError(
      typeof payload.message === 'string' ? payload.message : 'Automation turn denied by authorization policy.',
      denied.status,
      payload,
    )
  }

  const userText = buildAutomationUserMessage(input)
  const userMessage: UIMessage = {
    id: input.turnId,
    role: 'user',
    parts: [{ type: 'text', text: userText }],
  }

  // User-message save runs parallel to context assembly; a transient write
  // must not mask a later fatal context error (mirrors the act route).
  const saveUserMessageTask = actMessagePersistenceService.persistUserMessage({
    conversationId: cid,
    userId,
    turnId: input.turnId,
    modelId: effectiveModelId,
    latestUserContent: userText,
    latestUserText: userText,
    latestUserParts: [{ type: 'text', text: userText }],
    mode: 'act',
    billingActorUserId: userId,
    billingAccountId: resolvedBillingPayer.scope === 'workspace'
      ? resolvedBillingPayer.billingAccountId
      : undefined,
    billingSpendSubjectId: resolvedBillingPayer.subject.id,
    billingSpendSubjectKind: resolvedBillingPayer.subject.kind,
    skip: false,
  }).catch((error) => {
    logger.warn('[automations/turn] user-message persistence failed', {
      turnId: input.turnId,
      error: summarizeErrorForLog(error),
    })
    return undefined
  })

  const turnContextTask = actContextService.loadTurnContext({
    accessToken: undefined,
    conversationId: cid,
    indexedAttachments: undefined,
    indexedFileNames: undefined,
    latestUserText: userText,
    memoryEnabled,
    mentions,
    mentionedKnowledgeBaseIds: [],
    requestIdempotencyKey,
    requestFingerprint,
    billingProgrammaticSubjectId,
    billingUserId: userId,
    serverSecret,
    userId,
    externalContextEnabled: !isPostgresAppData,
    workspaceId: billingWorkspaceId,
  })

  const mediaIntentTask = (async () => {
    if (isPostgresAppData || !paid) return null
    if (!mayNeedMediaGenerationTools(userText)) return null
    return await classifyMediaToolIntentForTurn({
      userText,
      userId,
      accessToken: undefined,
      entitlements: runtimeEntitlements,
      idempotencyKey: requestIdempotencyKey,
      operationId: 'automation.turn.media-intent',
      programmaticSubjectId: billingProgrammaticSubjectId,
      requestFingerprint,
      workspaceId: billingWorkspaceId,
    })
  })()

  const [_userMessageId, turnContext, resolvedMediaToolIntent] = await Promise.all([
    saveUserMessageTask,
    turnContextTask,
    mediaIntentTask,
  ])
  const {
    autoRetrieval,
    conversationProjectId,
    docContextBundle,
    hasPreloadedDocContext,
    indexedAttachmentList,
    memoryContext,
    mentionsContext,
    projectInstructions,
    projectSettings,
    skillsContext,
    sourceCitationMap,
  } = turnContext

  const indexedNote = hasPreloadedDocContext
    ? indexedFilesSystemNotePreloaded(indexedAttachmentList)
    : indexedFilesSystemNote(indexedAttachmentList)

  let messagesForModel = await actContextService.buildMessagesForModel({
    requestMessages: [userMessage],
    latestUserMessage: userMessage,
    latestTurnId: input.turnId,
    conversationId: cid,
    userId,
    targetModelId: effectiveModelId,
  })
  messagesForModel = cloneMessagesWithIndexedFileHint(
    messagesForModel,
    indexedAttachmentList,
    hasPreloadedDocContext,
  )
  messagesForModel = await actContextService.prepareExistingMessagesForModel({
    accessToken: undefined,
    conversationId: cid,
    generateSummaryText: async ({ prompt, targetSummaryTokens }) => {
      const estimatedInputTokens = Math.ceil(prompt.length / 4) + 64
      const summaryReservation = await actUsageBudgetService.reserveForAttempt({
        entitlements: runtimeEntitlements,
        estimatedInputTokens,
        idempotencyKey: requestIdempotencyKey,
        maxOutputTokens: targetSummaryTokens,
        modelId: FREE_TIER_DEFAULT_MODEL_ID,
        operationId: 'automation.turn.context-summary',
        paid,
        requestFingerprint,
        userId,
        workspaceId: billingWorkspaceId,
        programmaticSubjectId: billingProgrammaticSubjectId,
      })
      if (!summaryReservation.ok) {
        throw new Error(String(summaryReservation.failure.payload.error ?? 'context_summary_budget_denied'))
      }
      let providerWorkStarted = false
      try {
        await actUsageBudgetService.markReservationStarted({
          reservationId: summaryReservation.reservationId,
          userId,
        })
        providerWorkStarted = true
        const summaryModel = await getLanguageModel(FREE_TIER_DEFAULT_MODEL_ID, undefined)
        const summaryResult = await generateText({
          model: summaryModel,
          temperature: 0.1,
          maxOutputTokens: targetSummaryTokens,
          prompt,
        })
        const summaryUsage = (summaryResult as unknown as {
          usage?: { inputTokens?: number; outputTokens?: number }
        }).usage
        await actUsageBudgetService.recordFinishedUsage({
          forceFreeTierLimits: false,
          inputTokens: summaryUsage?.inputTokens ?? estimatedInputTokens,
          modelId: FREE_TIER_DEFAULT_MODEL_ID,
          outputTokens: summaryUsage?.outputTokens ?? targetSummaryTokens,
          reservationId: summaryReservation.reservationId,
          userId,
        })
        return summaryResult.text.trim()
      } catch (error) {
        await actUsageBudgetService.releaseReservation({
          reason: error instanceof Error ? error.message : 'context_summary_provider_failed',
          reservationId: summaryReservation.reservationId,
          userId,
        }).catch((_releaseError) => undefined)
        if (providerWorkStarted && summaryReservation.reservationId) {
          await actUsageBudgetService.markReservationForReconcile({
            errorMessage: error instanceof Error ? error.message : 'context_summary_provider_failed',
            reservationId: summaryReservation.reservationId,
            userId,
          }).catch((_reconcileError) => undefined)
        }
        throw error
      }
    },
    messages: messagesForModel,
    targetModelId: effectiveModelId,
    userId,
  })

  const toolPreloadTasks = preloadActExternalToolTasks({ userId, serverSecret })
  const accountAllowedToolIdsTask = filterCatalogResources({
    authorization: overlayContext.authorizationService,
    capability: 'tools.use',
    context: routeContext,
    getId: (toolId) => toolId,
    resourceType: 'tool',
    values: OVERLAY_TOOL_IDS,
  })
  const accountAllowedConnectorIdsTask = toolPreloadTasks.connectedConnectorIdsTask
    .then((connectorIds) => filterCatalogResources({
      authorization: overlayContext.authorizationService,
      capability: 'integrations.use',
      context: routeContext,
      getId: (connectorId) => connectorId,
      resourceType: 'connector',
      values: connectorIds,
    }))
  const [accountAllowedToolIds, accountAllowedConnectorIds] = await Promise.all([
    accountAllowedToolIdsTask,
    accountAllowedConnectorIdsTask,
  ])

  const baseUrl = getBaseUrl()
  const actTooling = await prepareActTooling({
    accountAllowedConnectorIds,
    accountAllowedToolIds,
    accessToken: undefined,
    automationExecution: true,
    automationId: input.automationId,
    baseUrl,
    conversationId: cid,
    conversationProjectId,
    activeKnowledgeBaseIds: [],
    projectSettings,
    entitlements: runtimeEntitlements,
    effectiveModelId,
    isMultiModelFollowUpSlot: false,
    latestUserText: userText,
    memoryEnabled,
    mediaToolIntent: resolvedMediaToolIntent,
    paid,
    preloadTasks: toolPreloadTasks,
    requestFingerprint,
    requestedToolIds: [],
    serverSecret,
    turnId: input.turnId,
    userId,
    workspaceId: billingWorkspaceId,
    billingProgrammaticSubjectId,
  })

  const instructions = buildActAgentInstructions({
    availableToolIds: Object.keys(actTooling.tools),
    autoRetrieval,
    constants: {
      ACT_KNOWLEDGE_TOOLS_NOTE_NO_WEB,
      ACT_KNOWLEDGE_WEB_TOOLS_NOTE,
      ACT_PAID_PLAN_ACT_TOOLS_REALITY,
      FREE_TIER_NO_PAID_AGENT_CAPABILITIES,
      MATH_FORMAT_INSTRUCTION,
      MEMORY_SAVE_PROTOCOL,
      TABLE_FORMAT_INSTRUCTION,
    },
    docContextText: docContextBundle.contextText,
    effectiveModelId,
    exposedMediaTools: actTooling.exposedMediaTools,
    hasPreloadedDocContext,
    indexedNote,
    isMultiModelFollowUpSlot: false,
    memoryContext,
    memoryEnabled,
    mentionsContext,
    mode: undefined,
    paid,
    projectInstructions,
    requestedToolIds: [],
    skillsContext,
    userSystemPromptExtension: buildSecondarySystemPromptExtension(
      buildAutomationSystemPrompt(input),
    ),
    automationExecution: true,
    automationMode: false,
  })

  const modelMessages = await convertToModelMessages(messagesForModel)

  // Turn-level usage reservation — same shape the Work runner holds so usage
  // accounting stays consistent if the workflow dies mid-turn.
  const reservation = await actUsageBudgetService.reserveForAttempt({
    entitlements: runtimeEntitlements,
    estimatedInputTokens: Math.ceil(JSON.stringify(messagesForModel).length / 4) + 2_000,
    idempotencyKey: requestIdempotencyKey,
    maxOutputTokens: MAX_ACT_OUTPUT_TOKENS_PER_STEP,
    modelId: effectiveModelId,
    operationId: 'automation.turn',
    paid,
    requestFingerprint,
    userId,
    workspaceId: billingWorkspaceId,
    programmaticSubjectId: billingProgrammaticSubjectId,
  })
  if (!reservation.ok) {
    const payload = reservation.failure.payload as Record<string, unknown>
    throw new AutomationTurnError(
      typeof payload.message === 'string' ? payload.message : 'Automation turn could not reserve usage.',
      reservation.failure.statusCode,
      payload,
    )
  }
  await actUsageBudgetService.markReservationStarted({
    reservationId: reservation.reservationId,
    userId,
  })

  const toolDefinitions = await describePersonalChatWorkTools(
    actTooling.tools,
    Boolean(actTooling.toolApproval),
  )

  const toolingContext: PersonalChatWorkToolingContext = {
    accountAllowedConnectorIds: [...accountAllowedConnectorIds],
    accountAllowedToolIds: [...accountAllowedToolIds],
    activeKnowledgeBaseIds: [],
    baseUrl,
    billingProgrammaticSubjectId,
    conversationId: cid,
    conversationProjectId,
    effectiveModelId,
    entitlements: runtimeEntitlements,
    latestUserText: userText,
    mediaToolIntent: resolvedMediaToolIntent,
    memoryEnabled,
    paid,
    projectSettings,
    requestFingerprint,
    requestedToolIds: [],
    turnId: input.turnId,
    userId,
    workspaceId: billingWorkspaceId,
    automationExecution: true,
    automationId: input.automationId,
  }

  return {
    conversationId: String(cid),
    effectiveModelId,
    gatewayModelId: getGatewayModelId(effectiveModelId),
    instructions,
    messages: modelMessages,
    paid,
    reservationId: reservation.reservationId,
    sourceCitations: sourceCitationMap,
    toolDefinitions,
    toolingContext,
  }
}

export function aggregateAutomationTurnUsage(steps: StepResult<ToolSet>[]) {
  return steps.reduce((usage, step) => ({
    inputTokens: usage.inputTokens + (step.usage?.inputTokens ?? 0),
    outputTokens: usage.outputTokens + (step.usage?.outputTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0 })
}

/**
 * Settles a successful turn: finalizes the usage reservation, persists the
 * assistant reply (idempotent on turnId), and marks the automation run row
 * completed when one exists.
 */
export async function finalizeAutomationAgentTurn(args: {
  input: AutomationAgentTurnInput & { conversationId: string }
  plan: AutomationAgentTurnPlan
  steps: StepResult<ToolSet>[]
  text: string
  workflowRunId?: string
}): Promise<void> {
  const { input, plan } = args
  const usage = aggregateAutomationTurnUsage(args.steps)
  await actUsageBudgetService.recordFinishedUsage({
    forceFreeTierLimits: !plan.paid,
    inputTokens: usage.inputTokens,
    modelId: plan.effectiveModelId,
    operationId: `automation-run:${input.runId ?? input.turnId}:usage`,
    outputTokens: usage.outputTokens,
    reservationId: plan.reservationId,
    userId: input.userId,
  })
  const finishedToolCallIds = new Set<string>()
  for (const step of args.steps) {
    for (const result of step.toolResults ?? []) {
      if (result.toolCallId) finishedToolCallIds.add(result.toolCallId)
    }
  }
  const [providerCostMicros, workflowMetrics] = await Promise.all([
    calculateProviderCostMicros({
      inputTokens: usage.inputTokens,
      modelId: plan.effectiveModelId,
      outputTokens: usage.outputTokens,
    }),
    args.workflowRunId
      ? observeWorkflowRunMetrics(args.workflowRunId).catch((_error) => ({}))
      : Promise.resolve({}),
  ])
  await actMessagePersistenceService.persistAssistantFinish({
    attemptModelId: plan.effectiveModelId,
    conversationId: plan.conversationId as never,
    // The act route skips webhooks for automation executions.
    emitWebhook: false,
    event: { steps: args.steps, text: args.text, usage },
    finishedToolCallIds,
    agentRunMetrics: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      providerCostMicros,
      ...summarizeAgentToolMetrics(args.steps),
      ...workflowMetrics,
    },
    multiModelSlotIndex: 0,
    multiModelTotal: 1,
    sourceCitations: plan.sourceCitations,
    timedOut: false,
    timeoutMs: 0,
    toolFailuresByCallId: new Map(),
    turnId: input.turnId,
    userId: input.userId,
    throwOnError: true,
  })
  if (input.runId) {
    await automationService.markRunCompleted({
      runId: input.runId,
      userId: input.userId,
      conversationId: plan.conversationId,
    })
  }
}

/**
 * Settles a failed turn: releases the usage reservation (if one was taken),
 * records a failure assistant message so the automation conversation shows
 * what went wrong, and marks the run row failed when one exists.
 */
export async function failAutomationAgentTurn(args: {
  input: AutomationAgentTurnInput & { conversationId?: string }
  plan?: AutomationAgentTurnPlan
  steps?: StepResult<ToolSet>[]
  /** Failure message — the step boundary serializes inputs, so pass a string. */
  error: string
  workflowRunId?: string
}): Promise<void> {
  const { input } = args
  const message = args.error
  const steps = args.steps ?? []

  if (args.plan?.reservationId) {
    await actUsageBudgetService.releaseReservation({
      reason: message,
      reservationId: args.plan.reservationId,
      userId: input.userId,
    }).catch((_error) => undefined)
  }

  const conversationId = args.plan?.conversationId ?? input.conversationId
  if (conversationId) {
    try {
      await actMessagePersistenceService.persistAssistantFinish({
        attemptModelId: args.plan?.effectiveModelId ?? input.modelId ?? DEFAULT_MODEL_ID,
        conversationId: conversationId as never,
        emitWebhook: false,
        event: {
          steps,
          text: `Automation run failed: ${message}`,
          usage: aggregateAutomationTurnUsage(steps),
        },
        finishedToolCallIds: new Set(
          steps.flatMap((step) => (step.toolResults ?? [])
            .map((result) => result.toolCallId)
            .filter(Boolean)),
        ),
        multiModelSlotIndex: 0,
        multiModelTotal: 1,
        timedOut: false,
        timeoutMs: 0,
        toolFailuresByCallId: new Map(),
        turnId: input.turnId,
        userId: input.userId,
      })
    } catch (persistError) {
      logger.warn('[automations/turn] failure message persistence failed', {
        turnId: input.turnId,
        error: summarizeErrorForLog(persistError),
      })
    }
  }

  if (input.runId) {
    await automationService.markRunFailed({
      runId: input.runId,
      userId: input.userId,
      error: message,
    }).catch((markError) => {
      logger.warn('[automations/turn] markRunFailed failed', {
        runId: input.runId,
        error: summarizeErrorForLog(markError),
      })
    })
  }
}
