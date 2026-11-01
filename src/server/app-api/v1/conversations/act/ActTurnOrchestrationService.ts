import { randomUUID } from 'node:crypto'
import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { readValidatedJson } from '@/server/app-api/validated-input'
import {
  acquireConcurrentRequestSlot,
  concurrentRequestLimitResponse,
} from '@/server/security/concurrent-request-limiter'
import type { UIMessage } from '@/server/ai/sdk'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import {
  assertUserCanUseByokModel,
} from '@/server/ai/model-runtime'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { userFacingOpenRouterError } from '@/server/ai/model-runtime'
import { normalizeChatToolRequestIds } from '@/shared/chat/tool-requests'
import { OVERLAY_TOOL_IDS } from '@overlay/tools-core'
import { getInternalApiBaseUrl } from '@/server/web/app-url'
import { automationService } from '@/server/automations/http'
import { getOverlayServerContext } from '@/server/bootstrap'
import { buildSecondarySystemPromptExtension } from '@/server/agent/operator-system-prompt'
import {
  summarizeErrorForLog,
} from '@/shared/security/safe-log'
import { ActConversationRequest } from '@/shared/schemas/chat'
import {
  actContextService,
  actConversationRepository,
  actConversationErrorResponse,
  actEntitlementService,
  agentRunService,
  actMessagePersistenceService,
} from '@/server/conversations/http'
import type { ActEntitlementService } from '@/server/conversations/ActEntitlementService'
import {
  classifyMediaToolIntentForTurn,
  mayNeedMediaGenerationTools,
  normalizeStructuredMediaToolIntent,
  type MediaToolIntent,
} from '@/server/tools/media-tool-intent'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import { mergeReplyContextIntoMessagesForModel } from '@/shared/chat/reply-context-for-model'
import { sanitizeUiMessagesForModelApi } from '@/shared/chat/sanitize-ui-messages-for-model'
import { ensureActConversationId } from '@/server/conversations/ensure-act-conversation'
import {
  asConversationId,
} from '@/server/conversations/ActConversationRepository'
import { messagesRequireVision, resolveActAbortTimeoutMs, resolveActTurnId, resolveEffectiveActModelId } from './route-helpers'
import { buildActAgentInstructions } from './instructions'
import {
  authorizeActRequest,
} from './turn-authorization'
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
  filterCatalogResources,
} from '@/server/authorization'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'
import { resolveBillingPayer } from '@/server/billing/billing-runtime'
import { prepareActModelCandidates } from './model-candidates'
import { isHarnessBackendReady } from '@/server/harness/backend-readiness'
import {
  isPersonalHarnessRouteEligible,
  personalHarnessConversationClientId,
  startPersonalHarnessTurn,
} from './personal-harness-turn'
import { actRoutePolicyResponse, decidePersonalActRoute } from './act-route-policy'

export interface ActRouteDependencies {
  authorizationService?: AuthorizationService
  entitlementService?: Pick<ActEntitlementService, 'gateModelAccess'>
}

export async function executeActTurn(
  request: NextRequest,
  context: AppApiRouteContext,
  dependencies: ActRouteDependencies = {},
) {
  const requestId = request.headers.get('x-request-id')?.trim() || crypto.randomUUID()
  let concurrencySlot: { release: () => void } | null = null
  let requestModelId: string | undefined
  try {
    const [
      {
        ACT_KNOWLEDGE_TOOLS_NOTE_NO_WEB,
        ACT_KNOWLEDGE_WEB_TOOLS_NOTE,
        ACT_PAID_PLAN_ACT_TOOLS_REALITY,
        FREE_TIER_NO_PAID_AGENT_CAPABILITIES,
        MEMORY_SAVE_PROTOCOL,
        cloneMessagesWithIndexedFileHint,
        indexedFilesSystemNote,
        indexedFilesSystemNotePreloaded,
      },
      { MATH_FORMAT_INSTRUCTION },
      { TABLE_FORMAT_INSTRUCTION },
    ] = await Promise.all([
      import('@/server/agent/knowledge-agent-instructions'),
      import('@/shared/markdown/math-format-instructions'),
      import('@/shared/markdown/markdown-table-instructions'),
    ])
    const _ttftDebug = process.env.TTFT_DEBUG === 'true'
    let _t0 = 0, _tAuth = 0, _tPrep = 0, _tTools = 0
    let _tEnsureConversationMs = 0
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
      scope,
      askModelIds,
      turnId,
      modelId,
      indexedFileNames,
      indexedAttachments: rawIndexedAttachments,
      attachmentNames,
      replyContextForModel,
      historyBaseModelId,
      mode,
      automationMode,
      automationExecution,
      automationId,
      mediaToolIntent,
      requestedToolIds: rawRequestedToolIds,
      memoryEnabled: rawMemoryEnabled,
      actAbortTimeoutMs,
      harnessBudget,
      mentions: rawMentions,
      reasoning: rawReasoning,
    } = bodyResult.data
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages required' }, { status: 400 })
    }
    const uiMessages = messages as UIMessage[]
    const overlayContext = getOverlayServerContext()
    const { auth } = context
    const userId = auth.userId
    const personalWorkflowEligible = isPersonalHarnessRouteEligible({
      authType: auth.authType,
      automationExecution,
      automationMode,
    })
    const eligibility = decidePersonalActRoute({
      authType: auth.authType,
      automationExecution,
      automationMode,
      mode,
    })
    if (eligibility.kind !== 'admit') {
      return actRoutePolicyResponse(eligibility.kind, requestId)
    }
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
      variantIndex: 0,
    })
    let effectiveModelId = resolveEffectiveActModelId(modelId)
    requestModelId = effectiveModelId
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
    let modelGate: Awaited<ReturnType<ActEntitlementService['gateModelAccess']>>
    try {
      modelGate = await (dependencies.entitlementService ?? actEntitlementService).gateModelAccess({
        effectiveModelId,
        programmaticSubjectId: billingProgrammaticSubjectId,
        userId,
        workspaceId: billingWorkspaceId,
      })
    } catch (error) {
      if (!actConversationErrorResponse(error)) {
        return actRoutePolicyResponse('harness_unavailable', requestId)
      }
      throw error
    }
    const {
      appSettings,
      paid,
      runtimeEntitlements,
    } = modelGate
    const readiness = decidePersonalActRoute({
      authType: auth.authType,
      automationExecution,
      automationMode,
      harnessReady: isHarnessBackendReady(appSettings),
      mode,
    })
    if (readiness.kind !== 'admit') {
      return actRoutePolicyResponse(readiness.kind, requestId)
    }
    const resolvedBillingPayer = await resolveBillingPayer({
      programmaticSubjectId: billingProgrammaticSubjectId,
      userId,
      workspaceId: billingWorkspaceId,
    })
    const byokRequest = isByokModelId(effectiveModelId)
    if (byokRequest) {
      await assertUserCanUseByokModel(effectiveModelId, userId)
    }
    const authorizedModelIds = await resolveAuthorizedModelIds({ entitlements: runtimeEntitlements })
    if (!byokRequest && !authorizedModelIds.chat.has(effectiveModelId)) {
      return NextResponse.json(
        {
          error: 'model_not_allowed',
          message: `Model ${effectiveModelId} is not allowed by the server model policy.`,
        },
        { status: 403 },
      )
    }
    const modelCandidates = await prepareActModelCandidates({
          authorization: authorizationService,
          context,
          modelId: effectiveModelId,
          paid,
          onlyAllowZdrModels: appSettings?.onlyAllowZdrModels === true,
          requiresVision: messagesRequireVision(uiMessages),
          authorizedModelIds: authorizedModelIds.chat,
        })
    if (modelCandidates?.length) {
      effectiveModelId = modelCandidates[0]!
      requestModelId = effectiveModelId
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

    const tid = personalWorkflowEligible
      ? turnId?.trim() || context.requestIdempotencyKey?.trim() || randomUUID()
      : resolveActTurnId(turnId)
    let cid = conversationId ? asConversationId(conversationId) : undefined
    const trimmedClientId = conversationClientId?.trim()
    const durableClientId = trimmedClientId || (!conversationId && personalWorkflowEligible
      ? personalHarnessConversationClientId({
          actorUserId: userId,
          workspaceId: billingWorkspaceId,
          turnId: tid,
        })
      : undefined)
    if (!cid && durableClientId) {
      const ensureStartedAt = _ttftDebug ? performance.now() : 0
      cid = await ensureActConversationId({
        userId: conversationUserId,
        repository: actConversationRepository,
        conversationClientId: durableClientId,
        scope,
        entitlements: runtimeEntitlements,
        askModelIds,
        actModelId: effectiveModelId,
        workspaceId: context.workspace.workspace.id,
        createdByPrincipalId: context.workspace.principal.id,
      })
      if (_ttftDebug) _tEnsureConversationMs = performance.now() - ensureStartedAt
    }
    if (automationMode === true && automationId && cid) {
      await automationService.attachOwnedConversation({
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
    // P3.3: hoist Composio to Wave 1 — start before any await so it overlaps all prep work.
    // Cache in composio-tools.ts makes this ~0ms on repeat requests within 10 minutes.
    const toolPreloadTasks = preloadActExternalToolTasks({
      userId,
      accessToken,
      serverSecret,
      workspaceId: context.workspace.workspace.id,
      computerApprovalContext: personalWorkflowEligible ? 'work' : undefined,
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
      mode: 'ask',
      billingActorUserId: userId,
      billingAccountId: resolvedBillingPayer.scope === 'workspace'
        ? resolvedBillingPayer.billingAccountId
        : undefined,
      billingSpendSubjectId: resolvedBillingPayer.subject.id,
      billingSpendSubjectKind: resolvedBillingPayer.subject.kind,
      skip: false,
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
      requestIdempotencyKey: context.requestIdempotencyKey!,
      requestFingerprint: context.requestFingerprint,
      billingProgrammaticSubjectId,
      billingUserId: userId,
      serverSecret,
      // The resource owner, not the caller: a shared conversation loads its
      // owner's context while billing still follows the authenticated caller.
      userId: conversationUserId,
      externalContextEnabled: true,
      workspaceId: billingWorkspaceId,
    })

    const structuredMediaToolIntent = normalizeStructuredMediaToolIntent(mediaToolIntent)
    const mediaIntentTask: Promise<MediaToolIntent> = (() => {
      if (!paid) return Promise.resolve(null)
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
      docContextBundle,
      hasPreloadedDocContext,
      indexedAttachmentList,
      memoryContext,
      mentionsContext,
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
    messagesForModel = sanitizeUiMessagesForModelApi(
      mergeReplyContextIntoMessagesForModel(messagesForModel, replyContextForModel),
    )
    const userSystemPromptExtension = buildSecondarySystemPromptExtension(systemPrompt)

	    if (_ttftDebug) _tPrep = performance.now()
    const agentRunTask = agentRunService.startPersonalWorkflow({
      conversationId: cid,
      modelId: effectiveModelId,
      turnId: tid,
      userId: conversationUserId,
      userMessageId,
    })
    const [agentRun, actTooling] = await Promise.all([
        agentRunTask,
		      prepareActTooling({
		        accountAllowedConnectorIds,
		        accountAllowedToolIds,
		        accessToken,
	        automationExecution: automationExecution === true,
	        automationMode: automationMode === true,
	        automationId,
	        computerApprovalContext: 'work',
	        baseUrl: getInternalApiBaseUrl(request),
	        conversationId: cid,
        entitlements: runtimeEntitlements,
	        effectiveModelId,
	        forwardCookie: request.headers.get('cookie'),
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
    if (!agentRun) {
      throw new Error('Failed to establish AgentRun before generation')
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
      memoryContext,
      memoryEnabled,
      mentionsContext,
      mode,
      paid,
      requestedToolIds,
      skillsContext,
      userSystemPromptExtension,
      automationExecution: automationExecution === true,
      automationMode: automationMode === true,
    })

    if (!agentRun || !cid || !modelCandidates) throw new Error('Personal harness requires an admitted AgentRun and model candidates.')
    const personalAgentRun = agentRun
    return await startPersonalHarnessTurn({
        agentRun: personalAgentRun,
        auth,
        budget: {
          maxProviderCostUsd: harnessBudget?.maxProviderCostUsd,
          durationMs: harnessBudget?.durationMs
            ?? (actAbortTimeoutMs !== undefined
              ? resolveActAbortTimeoutMs({ requestedTimeoutMs: actAbortTimeoutMs })
              : undefined),
        },
        conversationId: cid,
        emitWebhook: true,
        effectiveModelId,
        goal: latestUserText ?? '',
        hasDynamicApproval: Boolean(actTooling.toolApproval),
        instructions: actInstructions,
        messagesForModel,
        modelCandidates,
        paid,
        principalId: context.workspace.principal.id,
        rawReasoning,
        requestId,
        releaseConcurrency: () => {
          concurrencySlot?.release()
          concurrencySlot = null
        },
        recordProgress: async content => {
          await agentRunService.recordProgress({
            content,
            runId: personalAgentRun.id,
            userId: conversationUserId,
          })
        },
        sourceCitations: sourceCitationMap,
        tools,
        toolingContext: {
          accountAllowedConnectorIds: [...accountAllowedConnectorIds],
          accountAllowedToolIds: [...accountAllowedToolIds],
          baseUrl: getInternalApiBaseUrl(request),
          billingProgrammaticSubjectId,
          conversationId: cid,
          effectiveModelId,
          latestUserText,
          mediaToolIntent: resolvedMediaToolIntent,
          memoryEnabled,
          mode: mode ?? 'chat',
          requestFingerprint: context.requestFingerprint,
          requestedToolIds: [...requestedToolIds],
          turnId: tid,
          userId,
          workspaceId: billingWorkspaceId,
        },
        workspaceId: billingWorkspaceId,
      })
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
    concurrencySlot?.release()
    return NextResponse.json(
      {
        error: requestModelId && isByokModelId(requestModelId)
          ? userFacingByokError(error)
          : userFacingOpenRouterError(error),
        requestId,
      },
      { status: 500, headers: { 'x-request-id': requestId } },
    )
  } finally {
    concurrencySlot?.release()
    concurrencySlot = null
  }
}

function userFacingByokError(error: unknown): string {
  const lower = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase()
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return 'Your provider rejected this API key. Update or retest it in Settings → Providers.'
  }
  if (lower.includes('404') || lower.includes('model not found') || lower.includes('does not exist')) {
    return 'This model is no longer available from the provider. Refresh the connection in Settings → Providers.'
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return 'Your provider is rate-limiting this key. Wait a moment and try again.'
  }
  if (lower.includes('tool') && (lower.includes('unsupported') || lower.includes('not supported'))) {
    return 'This provider model does not support the tools required by this chat.'
  }
  return 'The provider request failed. Retest the connection in Settings → Providers.'
}
