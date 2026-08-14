import { logger } from '@/server/observability/logger'
import { after, NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { readValidatedJson } from '@/server/app-api/validated-input'
import {
  acquireConcurrentRequestSlot,
  concurrentRequestLimitResponse,
} from '@/server/security/concurrent-request-limiter'
import { convertToModelMessages, createUIMessageStreamResponse, generateText, isStepCount, toUIMessageStream, ToolLoopAgent, type ToolApprovalConfiguration, type UIMessage } from '@/server/ai/sdk'
import type { LanguageModel } from '@/server/ai/provider-types'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import {
  getLanguageModel,
  getGatewayModelId,
  getOpenRouterLanguageModelCapturingRoutedModel,
} from '@/server/ai/model-runtime'
import { modelSupportsZeroDataRetention } from '@/shared/ai/gateway/model-data'
import { isKimiK3ModelId } from '@/shared/ai/gateway/model-types'
import { getChatModelFallbackCandidates } from '@/shared/ai/gateway/model-fallbacks'
import { userFacingOpenRouterError } from '@/server/ai/model-runtime'
import { uploadFilePartsForModel } from '@/server/ai/file-upload'
import {
  FREE_TIER_AUTO_MODEL_ID,
  FREE_TIER_DEFAULT_MODEL_ID,
  isNvidiaNimChatModelId,
} from '@/shared/ai/gateway/model-types'
import { normalizeChatToolRequestIds } from '@/shared/chat/tool-requests'
import { MAX_TOOL_STEPS_ACT } from '@/server/tools/tools/policy'
import { OVERLAY_TOOL_IDS } from '@overlay/tools-core'
import { getInternalApiBaseUrl } from '@/server/web/app-url'
import { automationService } from '@/server/automations/http'
import { getOverlayServerContext } from '@/server/bootstrap'
import { buildSecondarySystemPromptExtension } from '@/server/agent/operator-system-prompt'
import {
  summarizeErrorForLog,
  summarizeToolInputForLog,
} from '@/shared/security/safe-log'
import {
  createNvidiaNimChatLanguageModel,
  resolveNvidiaApiKey,
} from '@/server/ai/model-runtime'
import { ActConversationRequest } from '@/shared/schemas/chat'
import {
  actContextService,
  actConversationRepository,
  actConversationErrorResponse,
  actEntitlementService,
  agentRunService,
  actMessagePersistenceService,
  actUsageBudgetService,
} from '@/server/conversations/http'
import type { ActEntitlementService } from '@/server/conversations/ActEntitlementService'
import {
  classifyMediaToolIntentForTurn,
  mayNeedMediaGenerationTools,
  normalizeStructuredMediaToolIntent,
  type MediaToolIntent,
} from '@/server/tools/media-tool-intent'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import { ensureActConversationId } from '@/server/conversations/ensure-act-conversation'
import { registerToolLoopRun } from '@/server/conversations/tool-loop-run-registry'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import {
  MAX_ACT_MODEL_ATTEMPTS,
  drainReadableStream,
  messagesRequireVision,
  observeFirstTextToken,
  prefixFallbackNoticeAfterStart,
  resolveActAbortTimeoutMs,
  resolveActMultiModelState,
  resolveActTurnId,
  resolveEffectiveActModelId,
  runActModelAttempts,
  summarizeToolOutputForLog,
  type ActModelAttemptFailureReason,
} from './route-helpers'
import { buildActAgentInstructions } from './instructions'
import {
  logActTooling,
  prepareActTooling,
  preloadActExternalToolTasks,
} from './tooling'
import {
  getAuthorizedResourceUserId,
  getBillingProgrammaticSubjectId,
} from '@/server/app-api/bff-context'
import {
  authorizeCapability,
  authorizeCatalogResource,
  filterCatalogResources,
} from '@/server/authorization'
import type { AuthorizationCapability } from '@overlay/authz-contracts'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'
import { normalizeIntegrationProviderKey } from '@overlay/app-core'
import { readProjectSettings } from '@/shared/projects/project-settings'
import { meterAutomationWorkflowRun } from '@/server/billing/automation-workflow-billing'
import { resolveBillingPayer } from '@/server/billing/billing-runtime'
import { start } from 'workflow/api'
import { personalChatWorkWorkflow } from '@/workflows/personal-chat-work'
import { describePersonalChatWorkTools } from '@/server/conversations/personal-chat-work-tools'
import {
  calculateProviderCostMicros,
  summarizeAgentToolMetrics,
} from '@/server/conversations/agent-run-metrics'

export const maxDuration = 800

export interface ActRouteDependencies {
  authorizationService?: AuthorizationService
  entitlementService?: Pick<ActEntitlementService, 'gateModelAccess'>
}

export async function POST(
  request: NextRequest,
  context: AppApiRouteContext,
  dependencies: ActRouteDependencies = {},
) {
  const requestId = request.headers.get('x-request-id')?.trim() || crypto.randomUUID()
  let pendingAgentRunId: string | undefined
  let budgetReservationId: string | null = null
  let budgetReservationFinalized = false
  let currentUserId: string | undefined
  let currentResourceUserId: string | undefined
  let actWebhookSkip = false
  let concurrencySlot: { release: () => void } | null = null
  try {
    const {
      ACT_KNOWLEDGE_TOOLS_NOTE_NO_WEB,
      ACT_KNOWLEDGE_WEB_TOOLS_NOTE,
      ACT_PAID_PLAN_ACT_TOOLS_REALITY,
      FREE_TIER_NO_PAID_AGENT_CAPABILITIES,
      MEMORY_SAVE_PROTOCOL,
      cloneMessagesWithIndexedFileHint,
      indexedFilesSystemNote,
      indexedFilesSystemNotePreloaded,
    } = await import('@/server/agent/knowledge-agent-instructions')
    const { MATH_FORMAT_INSTRUCTION } = await import('@/shared/markdown/math-format-instructions')
    const { TABLE_FORMAT_INSTRUCTION } = await import('@/shared/markdown/markdown-table-instructions')
    const _ttftDebug = process.env.TTFT_DEBUG === 'true'
    let _t0 = 0, _tAuth = 0, _tPrep = 0, _tTools = 0, _tStreamCall = 0
    let _tEnsureConversationMs = 0
    let _tFirstToolCall = 0
    let _firstToolCallLogged = false
    if (_ttftDebug) _t0 = performance.now()
    const bodyResult = await readValidatedJson(request, context, ActConversationRequest)
    if (!bodyResult.ok) {
      bodyResult.response.headers.set('x-request-id', requestId)
      logger.warn('[conversations/act] request validation failed', {
        requestId,
        statusCode: bodyResult.response.status,
      })
      return bodyResult.response
    }
    const {
      messages,
      systemPrompt,
      conversationId,
      conversationClientId,
      projectId,
      knowledgeBaseId,
      knowledgeBaseIds,
      askModelIds,
      turnId,
      modelId,
      indexedFileNames,
      indexedAttachments: rawIndexedAttachments,
      attachmentNames,
      replyContextForModel,
      historyBaseModelId,
      mode,
      personalChatMode,
      automationMode,
      automationExecution,
      automationId,
      mediaToolIntent,
      requestedToolIds: rawRequestedToolIds,
      memoryEnabled: rawMemoryEnabled,
      actAbortTimeoutMs,
      mentions: rawMentions,
      /** Parallel multi-model: slot 0 = primary (full tools including Composio). Slots 1+ are compare-only. */
      multiModelSlotIndex: rawMultiModelSlotIndex,
      multiModelTotal: rawMultiModelTotal,
      reasoning: rawReasoning,
    } = bodyResult.data
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages required' }, { status: 400 })
    }
    const uiMessages = messages as UIMessage[]
    const overlayContext = getOverlayServerContext()
    const isPostgresAppData = overlayContext.appDataCapabilities.provider === 'postgres'
    actWebhookSkip = automationExecution === true || isPostgresAppData
    const { auth } = context
    const userId = auth.userId
    const conversationUserId = getAuthorizedResourceUserId(context)
    const billingWorkspaceId = context.workspace.workspace.id
    const mentionedAgent = rawMentions?.find((mention) => mention.type === 'agent')
    const billingProgrammaticSubjectId = getBillingProgrammaticSubjectId(
      context,
      automationExecution === true && auth.authType === 'service' && automationId
        ? `automation:${automationId}`
        : mentionedAgent
          ? `agent:${mentionedAgent.id}`
          : undefined,
    )
    currentUserId = userId
    currentResourceUserId = conversationUserId
    // C-10: Limit concurrent in-flight act requests per user to prevent
    // resource exhaustion. Each request can run for up to 800 seconds;
    // without this, a user could fire 60 concurrent requests instantly.
    concurrencySlot = acquireConcurrentRequestSlot(userId, { bucket: 'act' })
    if (!concurrencySlot) {
      return concurrentRequestLimitResponse('act')
    }
    const accessToken = auth.accessToken || undefined
    logger.info('[conversations/act] streamPersistence', {
      requestId,
      mode: 'direct-with-background-drain',
      conversationMode: mode,
      automationMode: automationMode === true,
      automationExecution: automationExecution === true,
      conversationId,
      turnId,
      variantIndex: rawMultiModelSlotIndex,
    })
    const preferredProjectModelId = await resolveProjectPreferredModelId({
      conversationId: conversationId as Id<'conversations'> | undefined,
      projectId,
      userId: conversationUserId,
    })
    const effectiveModelId = resolveEffectiveActModelId(modelId ?? preferredProjectModelId)
    const serverSecret = getInternalApiSecret()
    const requestedToolIds = normalizeChatToolRequestIds(rawRequestedToolIds)
    const memoryEnabled = rawMemoryEnabled !== false
    const authorizationService = dependencies.authorizationService ?? overlayContext.authorizationService
    const dynamicAuthorization = await authorizeActRequest({
      authorization: authorizationService,
      context,
      effectiveModelId,
      memoryEnabled,
      mentions: rawMentions,
      requestedToolIds,
    })
    if (dynamicAuthorization) return dynamicAuthorization
    const {
      appSettings,
      paid,
      runtimeEntitlements,
    } = await (dependencies.entitlementService ?? actEntitlementService).gateModelAccess({
      effectiveModelId,
      programmaticSubjectId: billingProgrammaticSubjectId,
      userId,
      workspaceId: billingWorkspaceId,
    })
    if (automationExecution === true) {
      const workflowMeter = await meterAutomationWorkflowRun({
        entitlements: runtimeEntitlements,
        idempotencyKey: context.requestIdempotencyKey,
        programmaticSubjectId: billingProgrammaticSubjectId ?? `automation:${automationId ?? turnId}`,
        requestFingerprint: context.requestFingerprint,
        userId,
        workspaceId: billingWorkspaceId,
      })
      if (!workflowMeter.ok) {
        return NextResponse.json(
          { ...workflowMeter.payload, error: workflowMeter.code },
          { status: workflowMeter.status },
        )
      }
    }
    const resolvedBillingPayer = await resolveBillingPayer({
      programmaticSubjectId: billingProgrammaticSubjectId,
      userId,
      workspaceId: billingWorkspaceId,
    })
    const authorizedModelIds = await resolveAuthorizedModelIds({
      entitlements: runtimeEntitlements,
    })
    if (!authorizedModelIds.chat.has(effectiveModelId)) {
      return NextResponse.json(
        {
          error: 'model_not_allowed',
          message: `Model ${effectiveModelId} is not allowed by the server model policy.`,
        },
        { status: 403 },
      )
    }
    if (_ttftDebug) _tAuth = performance.now()

    const {
      latestUserContent,
      latestUserMessage,
      latestUserParts,
      latestUserText,
    } = actMessagePersistenceService.getLatestUserPersistence({
      messages: uiMessages,
      attachmentNames,
    })

    let cid = conversationId as Id<'conversations'> | undefined
    const trimmedClientId = conversationClientId?.trim()
    const parallelCreate = !conversationId && Boolean(trimmedClientId)
    if (!cid && trimmedClientId) {
      const ensureStartedAt = _ttftDebug ? performance.now() : 0
      cid = await ensureActConversationId({
        userId: conversationUserId,
        repository: actConversationRepository,
        conversationClientId: trimmedClientId,
        entitlements: runtimeEntitlements,
        projectId,
        askModelIds,
        actModelId: effectiveModelId,
        workspaceId: context.workspace.workspace.id,
        createdByPrincipalId: context.workspace.principal.id,
      })
      if (_ttftDebug) _tEnsureConversationMs = performance.now() - ensureStartedAt
    }
    if (automationMode === true && automationId && cid) {
      await automationService.attachSourceConversation({
        automationId,
        conversationId: cid,
        userId: conversationUserId,
      }).catch((error) => {
        logger.warn('[conversations/act] Failed to link automation chat', {
          automationId,
          conversationId: cid,
          error,
        })
      })
    }
    // Bases named on this turn become part of the conversation's grounding and
    // also narrow this turn's retrieval. Access is verified inside the service.
    const turnKnowledgeBaseIds = [
      ...new Set([...(Array.isArray(knowledgeBaseIds) ? knowledgeBaseIds : []), ...(knowledgeBaseId ? [knowledgeBaseId] : [])]),
    ]
    if (cid && turnKnowledgeBaseIds.length > 0) {
      for (const id of turnKnowledgeBaseIds) {
        await overlayContext.knowledgeBaseService.attachConversation({
          conversationId: cid,
          knowledgeBaseId: id,
          userId: conversationUserId,
        })
      }
    }
    const tid = resolveActTurnId(turnId)

    const {
      isMultiModelFollowUpSlot,
      multiModelSlotIndex,
      multiModelTotal,
    } = resolveActMultiModelState({
      rawMultiModelSlotIndex,
      rawMultiModelTotal,
    })
    /** User message is persisted once (slot 0). Third-party (Composio) actions only on primary slot. */

    // P3.3: hoist Composio to Wave 1 — start before any await so it overlaps all prep work.
    // Cache in composio-tools.ts makes this ~0ms on repeat requests within 10 minutes.
    const toolPreloadTasks = preloadActExternalToolTasks({
      userId,
      accessToken,
      serverSecret,
    })
    const accountAllowedToolIdsTask = filterCatalogResources({
      authorization: authorizationService,
      capability: 'tools.use',
      context,
      getId: (toolId) => toolId,
      resourceType: 'tool',
      values: OVERLAY_TOOL_IDS,
    })
    const accountAllowedConnectorIdsTask = toolPreloadTasks.connectedConnectorIdsTask
      .then((connectorIds) => filterCatalogResources({
        authorization: authorizationService,
        capability: 'integrations.use',
        context,
        getId: (connectorId) => connectorId,
        resourceType: 'connector',
        values: connectorIds,
      }))

    // P3.2 Wave 1: user-message save + context fetches stay parallel.
    const saveUserMessageTask = actMessagePersistenceService.persistUserMessage({
      conversationId: cid,
      userId: conversationUserId,
      turnId: tid,
      modelId: effectiveModelId,
      latestUserContent,
      latestUserText,
      latestUserParts,
      attachmentNames,
      skipMemoryExtraction: !memoryEnabled,
      billingActorUserId: userId,
      billingAccountId: resolvedBillingPayer.scope === 'workspace'
        ? resolvedBillingPayer.billingAccountId
        : undefined,
      billingSpendSubjectId: resolvedBillingPayer.subject.id,
      billingSpendSubjectKind: resolvedBillingPayer.subject.kind,
      skip: isMultiModelFollowUpSlot,
    }).catch((error): undefined => {
      // History loading remains the authoritative preparation failure. A
      // transient user-message write must not mask a later fatal context error
      // or turn a recoverable stream start into an unrelated 500 response.
      logger.warn('[conversations/act] user-message persistence failed', {
        requestId,
        error: summarizeErrorForLog(error),
      })
      return undefined
    })
    const turnContextTask = actContextService.loadTurnContext({
      accessToken,
      conversationId: cid,
      indexedAttachments: rawIndexedAttachments,
      indexedFileNames,
      latestUserText,
      memoryEnabled,
      mentions: rawMentions,
      mentionedKnowledgeBaseIds: turnKnowledgeBaseIds,
      requestIdempotencyKey: context.requestIdempotencyKey!,
      requestFingerprint: context.requestFingerprint,
      billingProgrammaticSubjectId,
      billingUserId: userId,
      serverSecret,
      // The resource owner, not the caller: a shared conversation loads its
      // owner's context while billing still follows the authenticated caller.
      userId: conversationUserId,
      externalContextEnabled: !isPostgresAppData,
      workspaceId: billingWorkspaceId,
    })

    const structuredMediaToolIntent = normalizeStructuredMediaToolIntent(mediaToolIntent)
    const mediaIntentTask: Promise<MediaToolIntent> = (() => {
      if (isPostgresAppData) return Promise.resolve(null)
      if (isMultiModelFollowUpSlot || !paid) return Promise.resolve(null)
      if (structuredMediaToolIntent != null) return Promise.resolve(structuredMediaToolIntent)
      if (!mayNeedMediaGenerationTools(latestUserText)) return Promise.resolve(null)
      return classifyMediaToolIntentForTurn({
        userText: latestUserText,
        userId,
        accessToken,
        entitlements: runtimeEntitlements,
        idempotencyKey: context.requestIdempotencyKey,
        operationId: 'conversation.act.media-intent',
        programmaticSubjectId: billingProgrammaticSubjectId,
        requestFingerprint: context.requestFingerprint,
        workspaceId: billingWorkspaceId,
      })
    })()

    const [
      userMessageId,
      turnContext,
      resolvedMediaToolIntent,
      accountAllowedToolIds,
      accountAllowedConnectorIds,
    ] = await Promise.all([
      saveUserMessageTask,
      turnContextTask,
      mediaIntentTask,
      accountAllowedToolIdsTask,
      accountAllowedConnectorIdsTask,
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
      requestMessages: uiMessages,
      latestUserMessage,
      latestTurnId: tid,
      conversationId: cid,
      userId: conversationUserId,
      targetModelId: effectiveModelId,
      historyBaseModelId,
    })
    messagesForModel = cloneMessagesWithIndexedFileHint(messagesForModel, indexedAttachmentList, hasPreloadedDocContext)
    messagesForModel = await actContextService.prepareExistingMessagesForModel({
      accessToken,
      conversationId: cid,
      generateSummaryText: async ({ prompt, targetSummaryTokens }) => {
        const estimatedInputTokens = Math.ceil(prompt.length / 4) + 64
        const summaryReservation = await actUsageBudgetService.reserveForAttempt({
          entitlements: runtimeEntitlements,
          estimatedInputTokens,
          idempotencyKey: context.requestIdempotencyKey,
          maxOutputTokens: targetSummaryTokens,
          modelId: FREE_TIER_DEFAULT_MODEL_ID,
          operationId: 'conversation.act.context-summary',
          paid,
          requestFingerprint: context.requestFingerprint,
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
          const summaryModel = await getLanguageModel(FREE_TIER_DEFAULT_MODEL_ID, accessToken)
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
      historyBaseModelId,
      messages: messagesForModel,
      replyContextForModel,
      targetModelId: effectiveModelId,
      userId: conversationUserId,
    })
    const userSystemPromptExtension = buildSecondarySystemPromptExtension(systemPrompt)

    const mediaHeuristicSkipped =
      paid &&
      !isMultiModelFollowUpSlot &&
      structuredMediaToolIntent == null &&
      !mayNeedMediaGenerationTools(latestUserText) &&
      resolvedMediaToolIntent == null

	    if (_ttftDebug) _tPrep = performance.now()
	    // Declared before the primary LLM is chosen so the OpenRouter fetch callback can set it during calls.
	    let streamedRoutedModelId: string | undefined
    const actAbortTimeoutMsResolved = resolveActAbortTimeoutMs({
      requestedTimeoutMs: actAbortTimeoutMs,
      automationExecution: automationExecution === true,
    })
    const agentRunLeaseExpiresAt = Date.now() + actAbortTimeoutMsResolved + 60_000
    const agentRunEligible = Boolean(cid) && automationExecution !== true && automationMode !== true
    const useWorkRunner = agentRunEligible && personalChatMode === 'work'
    const agentRunTask = agentRunEligible
      ? (useWorkRunner
          ? agentRunService.startWork({
              conversationId: cid,
              modelId: effectiveModelId,
              turnId: tid,
              userId: conversationUserId,
              userMessageId,
            })
          : agentRunService.startChat({
              conversationId: cid,
              leaseExpiresAt: agentRunLeaseExpiresAt,
              modelId: effectiveModelId,
              turnId: tid,
              userId: conversationUserId,
              userMessageId,
              variantIndex: multiModelTotal > 1 ? multiModelSlotIndex : undefined,
            }))
      : Promise.resolve(undefined)
	    const [agentRun, actTooling] = await Promise.all([
        agentRunTask,
		      prepareActTooling({
		        accountAllowedConnectorIds,
		        accountAllowedToolIds,
		        accessToken,
	        automationExecution: automationExecution === true,
	        automationMode: automationMode === true,
	        automationId,
	        baseUrl: getInternalApiBaseUrl(request),
	        conversationId: cid,
	        conversationProjectId,
        activeKnowledgeBaseIds: turnKnowledgeBaseIds,
        projectSettings,
        entitlements: runtimeEntitlements,
	        effectiveModelId,
	        forwardCookie: request.headers.get('cookie'),
	        isMultiModelFollowUpSlot,
	        latestUserText,
	        memoryEnabled,
	        mediaToolIntent: resolvedMediaToolIntent,
	        mode,
	        paid,
	        preloadTasks: toolPreloadTasks,
	        requestFingerprint: context.requestFingerprint,
	        requestedToolIds,
	        serverSecret,
	        turnId: tid,
	        userId,
	        workspaceId: billingWorkspaceId,
	        billingProgrammaticSubjectId,
	      }),
		    ])
    if (agentRunEligible && !agentRun) {
      throw new Error('Failed to establish AgentRun before generation')
    }
    pendingAgentRunId = agentRun?.id
    if (!useWorkRunner && agentRun?.status === 'queued') {
      await agentRunService.markRunning({
        leaseExpiresAt: agentRunLeaseExpiresAt,
        runId: agentRun.id,
        userId: conversationUserId,
      })
    } else if (!useWorkRunner && agentRun && agentRun.status !== 'running') {
      throw new Error(`AgentRun ${agentRun.id} is already ${agentRun.status}`)
    }
    if (_ttftDebug) _tTools = performance.now()
    logActTooling(actTooling)
    const tools = actTooling.tools
    const actInstructions = buildActAgentInstructions({
      availableToolIds: Object.keys(tools),
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
      isMultiModelFollowUpSlot,
      memoryContext,
      memoryEnabled,
      mentionsContext,
      mode,
      paid,
      projectInstructions,
      requestedToolIds,
      skillsContext,
      userSystemPromptExtension,
      automationExecution: automationExecution === true,
      automationMode: automationMode === true,
    })

    if (useWorkRunner) {
      if (!agentRun || !cid) throw new Error('Work mode requires an AgentRun and conversation')
      await uploadFilePartsForModel(uiMessages as Array<{
        role: string
        parts?: Array<{
          type: string
          url?: string
          mediaType?: string
          fileName?: string
          filename?: string
          providerReference?: Record<string, string>
        }>
      }>, effectiveModelId)
      const workMessages = await convertToModelMessages(messagesForModel)
      const workMaxOutputTokens = 32_768
      const workReservation = await actUsageBudgetService.reserveForAttempt({
        userId,
        entitlements: runtimeEntitlements,
        idempotencyKey: context.requestIdempotencyKey,
        modelId: effectiveModelId,
        paid,
        estimatedInputTokens: Math.ceil(JSON.stringify(messagesForModel).length / 4) + 2_000,
        maxOutputTokens: workMaxOutputTokens,
        operationId: 'conversation.work',
        programmaticSubjectId: billingProgrammaticSubjectId,
        requestFingerprint: context.requestFingerprint,
        workspaceId: billingWorkspaceId,
      })
      if (!workReservation.ok) {
        const errorText = typeof workReservation.failure.payload.message === 'string'
          ? workReservation.failure.payload.message
          : 'Work mode could not reserve usage.'
        await agentRunService.fail({
          error: { code: 'budget_reservation_failed', message: errorText, retryable: true },
          errorText,
          runId: agentRun.id,
          userId: conversationUserId,
        })
        concurrencySlot?.release()
        concurrencySlot = null
        return NextResponse.json(
          workReservation.failure.payload,
          { status: workReservation.failure.statusCode },
        )
      }
      budgetReservationId = workReservation.reservationId
      await actUsageBudgetService.markReservationStarted({
        reservationId: budgetReservationId,
        userId,
      })
      const toolDefinitions = await describePersonalChatWorkTools(
        tools,
        Boolean(actTooling.toolApproval),
      )
      const workReasoning = isKimiK3ModelId(effectiveModelId) && rawReasoning && rawReasoning !== 'provider-default'
        ? 'xhigh'
        : rawReasoning === 'provider-default'
          ? undefined
          : rawReasoning
      const ownedReservationId = budgetReservationId
      const workflowRun = await start(personalChatWorkWorkflow, [{
        agentRunId: agentRun.id,
        billingUserId: userId,
        conversationId: cid,
        emitWebhook: !actWebhookSkip,
        gatewayModelId: getGatewayModelId(effectiveModelId),
        instructions: actInstructions,
        messages: workMessages,
        modelId: effectiveModelId,
        paid,
        ...(modelSupportsZeroDataRetention(effectiveModelId)
          ? { providerOptions: { gateway: { zeroDataRetention: true } } }
          : {}),
        ...(workReasoning ? { reasoning: workReasoning } : {}),
        reservationId: ownedReservationId,
        resourceUserId: conversationUserId,
        sourceCitations: sourceCitationMap,
        toolDefinitions,
        toolingContext: {
          accountAllowedConnectorIds: [...accountAllowedConnectorIds],
          accountAllowedToolIds: [...accountAllowedToolIds],
          activeKnowledgeBaseIds: [...turnKnowledgeBaseIds],
          baseUrl: getInternalApiBaseUrl(request),
          billingProgrammaticSubjectId,
          conversationId: cid,
          conversationProjectId,
          effectiveModelId,
          entitlements: runtimeEntitlements,
          latestUserText,
          memoryEnabled,
          paid,
          projectSettings,
          requestFingerprint: context.requestFingerprint,
          requestedToolIds: [...requestedToolIds],
          turnId: tid,
          userId,
          workspaceId: billingWorkspaceId,
        },
        turnId: tid,
      }])
      await agentRunService.attachWorkflow({
        runId: agentRun.id,
        userId: conversationUserId,
        workflowRunId: workflowRun.runId,
      })
      budgetReservationId = null
      budgetReservationFinalized = true
      concurrencySlot?.release()
      concurrencySlot = null
      return NextResponse.json({
        accepted: true,
        agentRunId: agentRun.id,
        workflowRunId: workflowRun.runId,
      }, { status: 202 })
    }

    const runActStream = async (params: {
      languageModel: LanguageModel
      modelId: string
      fallbackNotice?: string
    }) => {
    const attemptModelId = params.modelId
    const attemptModelSupportsZdr = modelSupportsZeroDataRetention(attemptModelId)
    // Kimi K3 always reasons and the AI SDK provider only exposes max effort.
    // Do not send a stale persisted `none` value that the provider cannot honor.
    const effectiveReasoning = isKimiK3ModelId(attemptModelId) && rawReasoning && rawReasoning !== 'provider-default'
      ? 'xhigh'
      : rawReasoning

    // v7: Upload large file attachments to the provider's file storage and
    // add provider references. Falls back to inline when the provider doesn't
    // support file uploads or no API key is set.
    await uploadFilePartsForModel(uiMessages as Array<{
      role: string
      parts?: Array<{
        type: string
        url?: string
        mediaType?: string
        fileName?: string
        filename?: string
        providerReference?: Record<string, string>
      }>
    }>, attemptModelId)
    // Convert only after uploads so AI SDK v7 sees providerReference on file parts.
    const modelMessages = await convertToModelMessages(messagesForModel)

    const agent = new ToolLoopAgent({
      model: params.languageModel,
      tools,
      ...(attemptModelSupportsZdr
        ? { providerOptions: { gateway: { zeroDataRetention: true } } }
        : {}),
      stopWhen: isStepCount(MAX_TOOL_STEPS_ACT),
      // Defense-in-depth: cap output tokens per step to match the budget
      // reservation's maxOutputTokens estimate. Prevents a single step from
      // consuming far more tokens than the reservation accounted for.
      maxOutputTokens: 8_192,
      instructions: actInstructions,
      // allowSystemInMessages: context-compaction.ts injects a trusted server-generated
      // summary as a system message. This is not user input — safe to pass through.
      allowSystemInMessages: true,
      // v7: top-level reasoning parameter standardizes reasoning effort across providers.
      // Only set when the user explicitly chose a level (not 'provider-default').
      ...(effectiveReasoning && effectiveReasoning !== 'provider-default'
        ? { reasoning: effectiveReasoning }
        : {}),
      // v7: OpenTelemetry traces for AI SDK calls. The functionId groups all
      // spans for this act turn under a single label.
      telemetry: {
        functionId: `act:${attemptModelId}`,
      },
      // v7: toolApproval replaces deprecated per-tool needsApproval. The MCP
      // approval function checks call_mcp_tool's input (serverId/toolName)
      // against the MCP server's policy at call time.
      ...(actTooling.toolApproval
        ? { toolApproval: actTooling.toolApproval as unknown as ToolApprovalConfiguration<typeof tools, unknown> }
        : {}),
    })

    const toolFailuresByCallId = new Map<string, { toolName: string; error: string }>()
    const finishedToolCallIds = new Set<string>()

    // Abort before Vercel's hard kill so onFinish can finalize gracefully.
    let wasAbortedByTimeout = false
    const abortController = new AbortController()
    const unregisterToolLoopRun = registerToolLoopRun(agentRun?.id, abortController)
    const hardTimeout = setTimeout(() => {
      wasAbortedByTimeout = true
      abortController.abort()
    }, actAbortTimeoutMsResolved)

    if (_ttftDebug) _tStreamCall = performance.now()
    let _tModelStreamReady = 0
    let result: Awaited<ReturnType<typeof agent.stream>>
    try {
      result = await agent.stream({
      messages: modelMessages,
      abortSignal: abortController.signal,
      onToolExecutionStart: ({ toolCall }) => {
        if (!toolCall) return
        if (_ttftDebug && !_firstToolCallLogged) {
          _firstToolCallLogged = true
          _tFirstToolCall = performance.now()
        }
        const n = toolCall.toolName
        if (n !== 'perplexity_search' && n !== 'parallel_search') return
        const input = toolCall.input as Record<string, unknown> | undefined
        logger.info(`[conversations/act] ${n} START`, {
          toolCallId: toolCall.toolCallId,
          input: summarizeToolInputForLog(input),
        })
      },
      onToolExecutionEnd: ({ toolCall, toolOutput, toolExecutionMs }) => {
        if (!toolCall?.toolName) return
        if (toolCall.toolCallId) finishedToolCallIds.add(toolCall.toolCallId)
        const success = toolOutput.type === 'tool-result'
        const output = success ? toolOutput.output : undefined
        const error = !success ? toolOutput.error : undefined
        const durationMs = toolExecutionMs
        if (!success && toolCall.toolCallId) {
          toolFailuresByCallId.set(toolCall.toolCallId, {
            toolName: toolCall.toolName,
            error: summarizeErrorForLog(error),
          })
        }
        const n = toolCall.toolName
        if (n === 'perplexity_search' || n === 'parallel_search') {
          if (success) {
            logger.info(`[conversations/act] ${n} OK`, {
              toolCallId: toolCall.toolCallId,
              durationMs,
              output: summarizeToolOutputForLog(output),
            })
          } else {
            logger.error(`[conversations/act] ${n} FAILED`, {
              toolCallId: toolCall.toolCallId,
              durationMs,
              error: summarizeErrorForLog(error),
            })
          }
        }
        if (!isPostgresAppData) {
          void import('@/server/tools/tools/record-tool-invocation')
            .then(({ fireAndForgetRecordToolInvocation }) => {
              fireAndForgetRecordToolInvocation({
                serverSecret,
                userId,
                toolName: toolCall.toolName,
                mode: 'act',
                modelId: attemptModelId,
                conversationId: conversationId ?? undefined,
                turnId: tid,
                success,
                durationMs,
                error,
              })
            })
            .catch((importError) => {
              logger.warn('[conversations/act] Tool invocation recorder unavailable:', summarizeErrorForLog(importError))
            })
        }
      },
      onEnd: async (event) => {
        try {
        const usage = event.usage
        const totalInputTokens = usage?.inputTokens ?? 0
        const totalOutputTokens = usage?.outputTokens ?? 0
        // Fallback: if the fetch-interceptor did not capture the model yet, try the step response.
        if (attemptModelId === FREE_TIER_AUTO_MODEL_ID && !streamedRoutedModelId) {
          const rid = event.steps.at(-1)?.response.modelId
          if (typeof rid === 'string' && rid) streamedRoutedModelId = rid
        }
        const usageResult = await actUsageBudgetService.recordFinishedUsage({
          userId,
          modelId: attemptModelId,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          forceFreeTierLimits: !paid,
          reservationId: budgetReservationId,
        })
        budgetReservationId = usageResult.reservationId
        budgetReservationFinalized = usageResult.finalized
        const providerCostMicros = await calculateProviderCostMicros({
          inputTokens: totalInputTokens,
          modelId: attemptModelId,
          outputTokens: totalOutputTokens,
        })
        logger.info('[conversations/act] stream finish', {
          requestId,
          modelId: attemptModelId,
          finishReason: event.finishReason,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          reservationFinalized: budgetReservationFinalized,
          routedModelId: streamedRoutedModelId ?? null,
        })

        await actMessagePersistenceService.persistAssistantFinish({
          accessToken,
          attemptModelId,
          conversationId: cid,
          emitWebhook: !actWebhookSkip,
          event,
          fallbackNotice: params.fallbackNotice,
          finishedToolCallIds,
          agentRunId: agentRun?.id,
          agentRunMetrics: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            providerCostMicros,
            ...summarizeAgentToolMetrics(event.steps),
            toolRetryCount: 0,
          },
          multiModelSlotIndex,
          multiModelTotal,
          routedModelId: streamedRoutedModelId,
          sourceCitations: sourceCitationMap,
          timedOut: wasAbortedByTimeout,
          timeoutMs: actAbortTimeoutMsResolved,
          toolFailuresByCallId,
          turnId: tid,
          userId: conversationUserId,
        })
        } finally {
          clearTimeout(hardTimeout)
          unregisterToolLoopRun()
        }
      },
      })
    } catch (err) {
      clearTimeout(hardTimeout)
      unregisterToolLoopRun()
      throw err
    }

    if (_ttftDebug) _tModelStreamReady = performance.now()

    const hasCitations = Object.keys(sourceCitationMap).length > 0

    const _uiStream = toUIMessageStream({
      stream: result.stream,
      originalMessages: uiMessages,
      onError: (error: unknown) => {
        logger.error('[conversations/act] stream error', {
          requestId,
          modelId: attemptModelId,
          error: summarizeErrorForLog(error),
        })
        return userFacingOpenRouterError(error)
      },
      messageMetadata: ({ part }) => {
        const metadata: Record<string, unknown> = {}
        if (hasCitations && (part.type === 'start' || part.type === 'finish')) {
          // Send early so the client can linkify **Sources:** while the reply streams.
          metadata.sourceCitations = sourceCitationMap
        }
        if (
          attemptModelId === FREE_TIER_AUTO_MODEL_ID &&
          part.type === 'finish' &&
          streamedRoutedModelId
        ) {
          metadata.routedModelId = streamedRoutedModelId
        }
        return Object.keys(metadata).length > 0 ? metadata : undefined
      },
    })
    const _uiResp = createUIMessageStreamResponse({ stream: _uiStream })
    let responseBody: ReadableStream<Uint8Array<ArrayBufferLike>> | null =
      prefixFallbackNoticeAfterStart(_uiResp.body, params.fallbackNotice)
    const responseHeaders = new Headers(_uiResp.headers)
    responseHeaders.set('x-request-id', requestId)
    if (agentRun?.id) responseHeaders.set('x-overlay-agent-run-id', agentRun.id)
    if (responseBody && agentRun?.id) {
      responseBody = observeFirstTextToken(responseBody, () => {
        void agentRunService.recordMetrics({
          metrics: { firstTokenAt: Date.now() },
          runId: agentRun.id,
          userId: conversationUserId,
        }).catch((_error) => undefined)
      })
    }
    if (responseBody) {
      if (cid) {
        const [clientBody, backgroundBody] = responseBody.tee()
        responseBody = clientBody
        after(async () => {
          try {
            await drainReadableStream(backgroundBody)
          } catch (err) {
            const reason = summarizeErrorForLog(err)
            const isAbort = reason.includes('abort') || reason.includes('AbortError')
            logger.error('[conversations/act] Background stream drain failed:', { reason, isAbort })
            if (budgetReservationId && !budgetReservationFinalized) {
              await actUsageBudgetService.releaseReservation({
                userId,
                reservationId: budgetReservationId,
                reason,
              }).catch((releaseErr) => logger.error('[conversations/act] Failed to release budget reservation:', summarizeErrorForLog(releaseErr)))
              budgetReservationId = null
            }
            const failure = isAbort
              ? new Error('generation_interrupted_server_timeout')
              : err
            if (agentRun?.id) {
              const errorText = userFacingOpenRouterError(failure)
              await agentRunService.fail({
                error: {
                  code: isAbort ? 'generation_interrupted' : 'stream_drain_failed',
                  message: errorText,
                  retryable: true,
                },
                errorText,
                runId: agentRun.id,
                userId: conversationUserId,
              }).catch((_error) => undefined)
            }
          }
        })
      }
    }
    if (_ttftDebug && responseBody) {
      const _decoder = new TextDecoder()
      let _buf = ''
      let _firstByteAt = 0
      let _firstEventAt = 0
      let _deltaLogged = false
      const _transform = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          if (!_deltaLogged) {
            if (_firstByteAt === 0) _firstByteAt = performance.now()
            _buf += _decoder.decode(chunk, { stream: true })
            // First meaningful UI-message-stream frame: tool-*, text*, or reasoning*
            // (skips the initial "start" and "start-step" scaffolding frames).
            if (_firstEventAt === 0 && /"type"\s*:\s*"(tool-|text|reasoning)/.test(_buf)) {
              _firstEventAt = performance.now()
            }
            // First actual text frame ("text" or "text-delta") — true first-token moment.
            if (/"type"\s*:\s*"text(?:-delta)?"/.test(_buf)) {
              _deltaLogged = true
              _buf = '' // release
              const _tDelta = performance.now()
              logger.info('[TTFT][act]', {
                model: attemptModelId,
                conversationClientId: trimmedClientId ?? null,
                parallelCreate,
                mediaHeuristicSkipped,
                mcpCatalog_ms: actTooling.ttft?.mcpCatalogMs ?? null,
                total_ms: +(_tDelta - _t0).toFixed(1),
                auth_ms: +(_tAuth - _t0).toFixed(1),
                ensureConversation_ms: _tEnsureConversationMs
                  ? +_tEnsureConversationMs.toFixed(1)
                  : null,
                prep_ms: +(_tPrep - _tAuth).toFixed(1),
                tools_ms: +(_tTools - _tPrep).toFixed(1),
                streamCall_ms: +(_tStreamCall - _tTools).toFixed(1),
                modelStreamReady_ms: _tModelStreamReady
                  ? +(_tModelStreamReady - _tStreamCall).toFixed(1)
                  : null,
                firstToolCall_ms:
                  _tFirstToolCall > 0
                    ? +(_tFirstToolCall - _tStreamCall).toFixed(1)
                    : null,
                firstByte_ms: +(_firstByteAt - _tStreamCall).toFixed(1),
                firstEvent_ms: _firstEventAt
                  ? +(_firstEventAt - _tStreamCall).toFixed(1)
                  : null,
                firstDelta_ms: +(_tDelta - _tStreamCall).toFixed(1),
              })
            } else if (_buf.length > 8192) {
              // Keep only the tail so the regex can still match across chunks without unbounded growth.
              _buf = _buf.slice(-1024)
            }
          }
          controller.enqueue(chunk)
        },
      })
      return new Response(responseBody.pipeThrough(_transform), {
        status: _uiResp.status,
        headers: responseHeaders,
      })
    }
    // Release the concurrency slot when the stream ends or is cancelled.
    if (responseBody) {
      const releaseSlot = concurrencySlot
      concurrencySlot = null // transfer ownership to the stream wrapper
      const releaseTransform = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) { controller.enqueue(chunk) },
        flush() { releaseSlot?.release() },
      })
      responseBody = responseBody.pipeThrough(releaseTransform)
    }
    return new Response(responseBody, {
      status: _uiResp.status,
      headers: responseHeaders,
    })
    }

    const estimatedInputTokens = Math.ceil(JSON.stringify(messagesForModel).length / 4) + 2_000
    const maxOutputTokens = 8_192
    const reserveBudgetForAttempt = async (attemptModelId: string) => {
      streamedRoutedModelId = undefined
      const reservation = await actUsageBudgetService.reserveForAttempt({
        userId,
        entitlements: runtimeEntitlements,
        idempotencyKey: context.requestIdempotencyKey,
        modelId: attemptModelId,
        paid,
        estimatedInputTokens,
        maxOutputTokens,
        operationId: 'conversation.act',
        programmaticSubjectId: billingProgrammaticSubjectId,
        requestFingerprint: context.requestFingerprint,
        workspaceId: billingWorkspaceId,
      })
      if (!reservation.ok) {
        const errorCode = typeof reservation.failure.payload.error === 'string'
          ? reservation.failure.payload.error
          : undefined
        logger.warn('[conversations/act] model attempt skipped before provider call', {
          requestId,
          modelId: attemptModelId,
          reason: errorCode ?? 'budget_reservation_failed',
          statusCode: reservation.failure.statusCode,
        })
        return {
          ok: false as const,
          reason: modelAttemptFailureReasonFromReservation(errorCode),
          response: NextResponse.json(reservation.failure.payload, { status: reservation.failure.statusCode }),
        }
      }
      budgetReservationId = reservation.reservationId
      budgetReservationFinalized = false
      return { ok: true as const }
    }

    const languageModelForAttempt = async (attemptModelId: string): Promise<LanguageModel> => {
      if (isNvidiaNimChatModelId(attemptModelId)) {
        const nvidiaKey = await resolveNvidiaApiKey(accessToken)
        if (!nvidiaKey) {
          throw new Error('NVIDIA_API_KEY is not configured.')
        }
        streamedRoutedModelId = attemptModelId
        return createNvidiaNimChatLanguageModel(attemptModelId, nvidiaKey)
      }

      if (attemptModelId === FREE_TIER_AUTO_MODEL_ID) {
        return getOpenRouterLanguageModelCapturingRoutedModel(
          FREE_TIER_AUTO_MODEL_ID,
          accessToken,
          (m) => { streamedRoutedModelId = m },
        )
      }

      return getLanguageModel(attemptModelId, accessToken)
    }

    const fallbackModelIds = getChatModelFallbackCandidates({
      modelId: effectiveModelId,
      paid,
      onlyAllowZdrModels: paid && appSettings?.onlyAllowZdrModels === true,
      requiresVision: messagesRequireVision(uiMessages),
      maxCandidates: MAX_ACT_MODEL_ATTEMPTS - 1,
    }).filter((candidateId) => authorizedModelIds.chat.has(candidateId))
    const attemptModelIds = [...new Set([effectiveModelId, ...fallbackModelIds])].slice(0, MAX_ACT_MODEL_ATTEMPTS)
    logger.info('[conversations/act] model attempts planned', {
      requestId,
      requestedModelId: modelId ?? null,
      effectiveModelId,
      attemptModelIds,
      paid,
      onlyAllowZdrModels: paid && appSettings?.onlyAllowZdrModels === true,
    })
    const _actResponse = await runActModelAttempts<Response>({
      attemptModelIds,
      reserveBudgetForAttempt,
      onFallback: (from, to, failedAttempts) => {
        logger.warn('[conversations/act] model fallback', {
          requestId,
          from,
          to,
          failedAttempts,
        })
      },
      onAttemptFailure: async (error, attemptModelId, hasFallback) => {
        logger.warn('[conversations/act] model attempt failed', {
          requestId,
          modelId: attemptModelId,
          hasFallback,
          error: summarizeErrorForLog(error),
        })
        if (budgetReservationId && !budgetReservationFinalized) {
          await actUsageBudgetService.releaseReservation({
            userId,
            reservationId: budgetReservationId,
            reason: summarizeErrorForLog(error),
          }).catch((releaseErr) => logger.error('[conversations/act] Failed to release budget reservation:', summarizeErrorForLog(releaseErr)))
          budgetReservationId = null
        }
      },
      runAttempt: async ({ attemptModelId, fallbackNotice }) => {
        streamedRoutedModelId = undefined
        logger.info('[conversations/act] model attempt starting', {
          requestId,
          effectiveModelId,
          attemptModelId,
          gatewayModelId: safeGatewayModelId(attemptModelId),
          fallbackNotice: fallbackNotice ?? null,
        })
        const languageModel = await languageModelForAttempt(attemptModelId)
        await actUsageBudgetService.markReservationStarted({
          userId,
          reservationId: budgetReservationId,
        })
        return await runActStream({
          languageModel,
          modelId: attemptModelId,
          fallbackNotice,
        })
      },
    })
    concurrencySlot?.release()
    concurrencySlot = null
    return _actResponse
	  } catch (error) {
    const serviceResponse = actConversationErrorResponse(error)
    if (serviceResponse) {
      serviceResponse.headers.set('x-request-id', requestId)
      logger.warn('[conversations/act] service error response', {
        requestId,
        statusCode: serviceResponse.status,
        error: summarizeErrorForLog(error),
      })
      return serviceResponse
    }
	    logger.error('[conversations/act] Error:', {
      requestId,
      error: summarizeErrorForLog(error),
    })
	    if (budgetReservationId && !budgetReservationFinalized) {
	      await actUsageBudgetService.releaseReservation({
	        userId: currentUserId ?? 'unknown',
	        reservationId: budgetReservationId,
	        reason: summarizeErrorForLog(error),
	      }).catch((releaseErr) => logger.error('[conversations/act] Failed to release budget reservation:', summarizeErrorForLog(releaseErr)))
	      budgetReservationId = null
	    }
    concurrencySlot?.release()
    if (pendingAgentRunId) {
      const errorText = userFacingOpenRouterError(error)
      await agentRunService.fail({
        error: {
          code: 'generation_failed',
          message: errorText,
          retryable: true,
        },
        errorText,
        runId: pendingAgentRunId,
        userId: currentResourceUserId,
      }).catch((_error) => undefined)
    }
    return NextResponse.json(
      { error: userFacingOpenRouterError(error), requestId },
      { status: 500, headers: { 'x-request-id': requestId } },
    )
  }
}

async function authorizeActRequest(args: {
  authorization: ReturnType<typeof getOverlayServerContext>['authorizationService']
  context: AppApiRouteContext
  effectiveModelId: string
  memoryEnabled: boolean
  mentions: unknown
  requestedToolIds: readonly string[]
}): Promise<NextResponse | null> {
  const modelDenied = await authorizeCatalogResource({
    authorization: args.authorization,
    capability: 'models.use',
    context: args.context,
    resourceId: args.effectiveModelId,
    resourceType: 'model',
  })
  if (modelDenied) return modelDenied

  const capabilityRequirements = new Set<AuthorizationCapability>()
  if (args.requestedToolIds.length > 0) capabilityRequirements.add('tools.use')
  if (args.requestedToolIds.includes('web_search')) capabilityRequirements.add('web_search.use')
  if (args.memoryEnabled || args.requestedToolIds.includes('memory')) capabilityRequirements.add('memory.use')
  for (const mention of Array.isArray(args.mentions) ? args.mentions : []) {
    if (!mention || typeof mention !== 'object') continue
    const type = 'type' in mention ? mention.type : undefined
    if (type === 'connector') capabilityRequirements.add('integrations.use')
    if (type === 'knowledge') capabilityRequirements.add('knowledge.read')
    if (type === 'skill') capabilityRequirements.add('skills.use')
    if (type === 'mcp') capabilityRequirements.add('mcp.use')
    if (type === 'automation') capabilityRequirements.add('automations.use')
  }
  for (const mention of Array.isArray(args.mentions) ? args.mentions : []) {
    if (!mention || typeof mention !== 'object') continue
    const type = 'type' in mention ? mention.type : undefined
    const id = 'id' in mention && typeof mention.id === 'string'
      ? normalizeIntegrationProviderKey(mention.id)
      : ''
    if (type !== 'connector' || !id) continue
    const denied = await authorizeCatalogResource({
      authorization: args.authorization,
      capability: 'integrations.use',
      context: args.context,
      resourceId: id,
      resourceType: 'connector',
    })
    if (denied) return denied
  }
  for (const capability of capabilityRequirements) {
    const denied = await authorizeCapability({
      authorization: args.authorization,
      capability,
      context: args.context,
    })
    if (denied) return denied
  }
  for (const toolId of args.requestedToolIds) {
    const denied = await authorizeCatalogResource({
      authorization: args.authorization,
      capability: 'tools.use',
      context: args.context,
      resourceId: toolId,
      resourceType: 'tool',
    })
    if (denied) return denied
  }
  return null
}

function modelAttemptFailureReasonFromReservation(errorCode?: string): ActModelAttemptFailureReason {
  if (errorCode === 'insufficient_budget') return 'budget'
  if (errorCode === 'pricing_missing') return 'pricing'
  return 'reservation'
}

function safeGatewayModelId(modelId: string): string | null {
  try {
    return getGatewayModelId(modelId)
  } catch (_error) {
    return null
  }
}

async function resolveProjectPreferredModelId(args: {
  conversationId?: Id<'conversations'>
  projectId?: string
  userId: string
}): Promise<string | undefined> {
  try {
    const conversation = args.conversationId
      ? await actConversationRepository.getConversation({
          conversationId: args.conversationId,
          userId: args.userId,
        })
      : null
    const projectId = args.projectId?.trim() || conversation?.projectId
    if (!projectId) return undefined
    const project = await actConversationRepository.getProject({
      projectId: projectId as Id<'projects'>,
      userId: args.userId,
    })
    if (!project || project.archivedAt) return undefined
    return readProjectSettings(project.settings).preferredModelId
  } catch (_error) {
    return undefined
  }
}
