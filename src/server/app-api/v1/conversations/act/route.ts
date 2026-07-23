import { logger } from '@/server/observability/logger'
import { after, NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { readValidatedJson } from '@/server/app-api/validated-input'
import { convertToModelMessages, stepCountIs, ToolLoopAgent, type UIMessage } from '@/server/ai/sdk'
import type { LanguageModelV3 } from '@/server/ai/provider-types'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import {
  getLanguageModel,
  getGatewayModelId,
  getOpenRouterLanguageModelCapturingRoutedModel,
} from '@/server/ai/model-runtime'
import { modelSupportsZeroDataRetention } from '@/shared/ai/gateway/model-data'
import { getChatModelFallbackCandidates } from '@/shared/ai/gateway/model-fallbacks'
import { userFacingOpenRouterError } from '@/server/ai/model-runtime'
import {
  FREE_TIER_AUTO_MODEL_ID,
  isNvidiaNimChatModelId,
} from '@/shared/ai/gateway/model-types'
import { normalizeChatToolRequestIds } from '@/shared/chat/tool-requests'
import { MAX_TOOL_STEPS_ACT } from '@/server/tools/tools/policy'
import { getInternalApiBaseUrl } from '@/server/web/app-url'
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
import {
  canMirrorToCloudflareStream,
  mirrorChatStreamToCloudflare,
} from '@/server/chat/cloudflare-stream-mirror'
import { ActConversationRequest } from '@/shared/schemas/chat'
import {
  actContextService,
  actConversationRepository,
  actConversationErrorResponse,
  actEntitlementService,
  actGeneratingMessageService,
  actMessagePersistenceService,
  actUsageBudgetService,
} from '@/server/conversations/http'
import {
  classifyMediaToolIntentForTurn,
  mayNeedMediaGenerationTools,
  normalizeStructuredMediaToolIntent,
  type MediaToolIntent,
} from '@/server/tools/media-tool-intent'
import { ensureActConversationId } from '@/server/conversations/ensure-act-conversation'
import { createPersistedTextDeltaTransform } from '@/server/conversations/chat-stream-persistence'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import {
  MAX_ACT_MODEL_ATTEMPTS,
  drainReadableStream,
  messagesRequireVision,
  prefixFallbackNoticeAfterStart,
  resolveActAbortTimeoutMs,
  resolveActMultiModelState,
  resolveActStreamPersistence,
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
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import {
  authorizeCapability,
  authorizeCatalogResource,
} from '@/server/authorization'
import type { AuthorizationCapability } from '@overlay/authz-contracts'

export const maxDuration = 800

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  const requestId = request.headers.get('x-request-id')?.trim() || crypto.randomUUID()
  let pendingGeneratingMessageId: Id<'conversationMessages'> | undefined
  let budgetReservationId: string | null = null
  let budgetReservationFinalized = false
  let currentUserId: string | undefined
  let currentResourceUserId: string | undefined
  let actWebhookConversationId: Id<'conversations'> | undefined
  let actWebhookTurnId: string | undefined
  let actWebhookSkip = false
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
      streamPersistenceMode,
      mentions: rawMentions,
      /** Parallel multi-model: slot 0 = primary (full tools including Composio). Slots 1+ are compare-only. */
      multiModelSlotIndex: rawMultiModelSlotIndex,
      multiModelTotal: rawMultiModelTotal,
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
    currentUserId = userId
    currentResourceUserId = conversationUserId
    const accessToken = auth.accessToken || undefined
	    const streamPersistence = resolveActStreamPersistence({
	      requestedMode: streamPersistenceMode,
	    })
	    const useCloudflareStreamMirror = streamPersistence.useCloudflareStreamMirror
	    const resolvedStreamPersistenceMode = streamPersistence.mode
    logger.info('[conversations/act] streamPersistence', {
      requestId,
      mode: resolvedStreamPersistenceMode,
      conversationMode: mode,
      automationMode: automationMode === true,
      automationExecution: automationExecution === true,
      conversationId,
      turnId,
      variantIndex: rawMultiModelSlotIndex,
    })
    const effectiveModelId = resolveEffectiveActModelId(modelId)
    const serverSecret = getInternalApiSecret()
    const requestedToolIds = normalizeChatToolRequestIds(rawRequestedToolIds)
    const memoryEnabled = rawMemoryEnabled !== false
    const dynamicAuthorization = await authorizeActRequest({
      authorization: overlayContext.authorizationService,
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
    } = await actEntitlementService.gateModelAccess({
      effectiveModelId,
      userId,
    })
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
      })
      if (_ttftDebug) _tEnsureConversationMs = performance.now() - ensureStartedAt
    }
    if (cid && knowledgeBaseId) {
      await overlayContext.knowledgeBaseService.attachConversation({
        conversationId: cid,
        knowledgeBaseId,
        userId: conversationUserId,
      })
    }
    const tid = resolveActTurnId(turnId)
    actWebhookConversationId = cid
    actWebhookTurnId = tid

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
      skip: isMultiModelFollowUpSlot,
    })
    const turnContextTask = actContextService.loadTurnContext({
      accessToken,
      conversationId: cid,
      indexedAttachments: rawIndexedAttachments,
      indexedFileNames,
      latestUserText,
      memoryEnabled,
      mentions: rawMentions,
      serverSecret,
      userId: conversationUserId,
      externalContextEnabled: !isPostgresAppData,
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
      })
    })()

    const [, turnContext, resolvedMediaToolIntent] = await Promise.all([
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

	    const modelMessages = await convertToModelMessages(messagesForModel)
	    if (_ttftDebug) _tPrep = performance.now()
	    // Declared before the primary LLM is chosen so the OpenRouter fetch callback can set it during calls.
	    let streamedRoutedModelId: string | undefined
	    const [generatingMessageId, actTooling] = await Promise.all([
	      actGeneratingMessageService.start({
	        conversationId: cid,
	        userId: conversationUserId,
	        turnId: tid,
	        modelId: effectiveModelId,
	        multiModelTotal,
	        multiModelSlotIndex,
	      }),
	      prepareActTooling({
	        accessToken,
	        automationExecution: automationExecution === true,
	        automationMode: automationMode === true,
	        automationId,
	        baseUrl: getInternalApiBaseUrl(request),
	        conversationId: cid,
	        conversationProjectId,
	        effectiveModelId,
	        forwardCookie: request.headers.get('cookie'),
	        isMultiModelFollowUpSlot,
	        latestUserText,
	        memoryEnabled,
	        mediaToolIntent: resolvedMediaToolIntent,
	        mode,
	        paid,
	        preloadTasks: toolPreloadTasks,
	        requestedToolIds,
	        serverSecret,
	        turnId: tid,
	        userId,
	      }),
	    ])
    pendingGeneratingMessageId = generatingMessageId
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

    const runActStream = async (params: {
      languageModel: LanguageModelV3
      modelId: string
      fallbackNotice?: string
    }) => {
    const attemptModelId = params.modelId
    const attemptModelSupportsZdr = modelSupportsZeroDataRetention(attemptModelId)
    const agent = new ToolLoopAgent({
      model: params.languageModel,
      tools,
      ...(attemptModelSupportsZdr
        ? { providerOptions: { gateway: { zeroDataRetention: true } } }
        : {}),
      stopWhen: stepCountIs(MAX_TOOL_STEPS_ACT),
      instructions: actInstructions,
    })

    const toolFailuresByCallId = new Map<string, { toolName: string; error: string }>()
    const finishedToolCallIds = new Set<string>()

    // Abort before Vercel's hard kill so onFinish can finalize gracefully.
    const actAbortTimeoutMsResolved = resolveActAbortTimeoutMs({
      requestedTimeoutMs: actAbortTimeoutMs,
      automationExecution: automationExecution === true,
    })
    let wasAbortedByTimeout = false
    const abortController = new AbortController()
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
      ...(generatingMessageId ? {
        experimental_transform: createPersistedTextDeltaTransform({
          appendTextDelta: async (textDelta) => {
            return await actGeneratingMessageService.appendTextDelta({
              messageId: generatingMessageId,
              textDelta,
            })
          },
        }),
      } : {}),
      experimental_onToolCallStart: ({ toolCall }) => {
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
      experimental_onToolCallFinish: ({ toolCall, success, durationMs, output, error }) => {
        if (!toolCall?.toolName) return
        if (toolCall.toolCallId) finishedToolCallIds.add(toolCall.toolCallId)
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
      onFinish: async (event) => {
        const totalUsage = event.totalUsage
        const totalInputTokens = totalUsage?.inputTokens ?? 0
        const totalOutputTokens = totalUsage?.outputTokens ?? 0
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
          generatingMessageId,
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
      },
      })
    } catch (err) {
      clearTimeout(hardTimeout)
      throw err
    }

    clearTimeout(hardTimeout)
    if (_ttftDebug) _tModelStreamReady = performance.now()

    const hasCitations = Object.keys(sourceCitationMap).length > 0

    const _uiResp = result.toUIMessageStreamResponse({
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
    let responseBody: ReadableStream<Uint8Array<ArrayBufferLike>> | null =
      prefixFallbackNoticeAfterStart(_uiResp.body, params.fallbackNotice)
    const responseHeaders = new Headers(_uiResp.headers)
    responseHeaders.set('x-request-id', requestId)
    if (useCloudflareStreamMirror) {
      responseHeaders.set('x-overlay-generating-message-id', generatingMessageId ?? '')
      responseHeaders.set('x-overlay-auth-user-id', userId)
      responseHeaders.set('x-overlay-stream-persistence-mode', resolvedStreamPersistenceMode)
    }
    if (responseBody) {
      if (isPostgresAppData || resolvedStreamPersistenceMode !== 'direct') {
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
            await actGeneratingMessageService.fail({
              conversationId: actWebhookConversationId,
              emitWebhook: !actWebhookSkip,
              error: isAbort
                ? new Error('generation_interrupted_server_timeout')
                : err,
              messageId: generatingMessageId,
              turnId: actWebhookTurnId,
              userId: conversationUserId,
            })
          }
        })
      }
      if (useCloudflareStreamMirror) {
        if (cid && canMirrorToCloudflareStream(request)) {
          const [clientBody, mirrorBody] = responseBody.tee()
          responseBody = clientBody
          after(async () => {
            try {
              await mirrorChatStreamToCloudflare({
                request,
                stream: mirrorBody,
                metadata: {
                  conversationId: cid,
                  messageId: generatingMessageId,
                  mode,
                  modelId: attemptModelId,
                  requestId,
                  turnId: tid,
                  userId: conversationUserId,
                  variantIndex: multiModelSlotIndex,
                },
              })
            } catch (err) {
              logger.warn('[chat-stream] cloudflare mirror failed', {
                requestId,
                conversationId: cid,
                turnId: tid,
                variantIndex: multiModelSlotIndex,
                reason: summarizeErrorForLog(err),
              })
            }
          })
        } else {
          logger.warn('[chat-stream] cloudflare mirror unavailable', {
            requestId,
            conversationId: cid,
            hasConversationId: Boolean(cid),
            turnId: tid,
            variantIndex: multiModelSlotIndex,
          })
        }
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
    return new Response(responseBody, {
      status: _uiResp.status,
      headers: responseHeaders,
    })
    }

    const estimatedInputTokens = Math.ceil(JSON.stringify(modelMessages).length / 4) + 2_000
    const maxOutputTokens = 8_192
    const reserveBudgetForAttempt = async (attemptModelId: string) => {
      streamedRoutedModelId = undefined
      const reservation = await actUsageBudgetService.reserveForAttempt({
        userId,
        entitlements: runtimeEntitlements,
        modelId: attemptModelId,
        paid,
        estimatedInputTokens,
        maxOutputTokens,
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

    const languageModelForAttempt = async (attemptModelId: string): Promise<LanguageModelV3> => {
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
    })
    const attemptModelIds = [...new Set([effectiveModelId, ...fallbackModelIds])].slice(0, MAX_ACT_MODEL_ATTEMPTS)
    logger.info('[conversations/act] model attempts planned', {
      requestId,
      requestedModelId: modelId ?? null,
      effectiveModelId,
      attemptModelIds,
      paid,
      onlyAllowZdrModels: paid && appSettings?.onlyAllowZdrModels === true,
    })
    return await runActModelAttempts<Response>({
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
        return await runActStream({
          languageModel,
          modelId: attemptModelId,
          fallbackNotice,
        })
      },
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
	    if (budgetReservationId && !budgetReservationFinalized) {
	      await actUsageBudgetService.releaseReservation({
	        userId: currentUserId ?? 'unknown',
	        reservationId: budgetReservationId,
	        reason: summarizeErrorForLog(error),
	      }).catch((releaseErr) => logger.error('[conversations/act] Failed to release budget reservation:', summarizeErrorForLog(releaseErr)))
	      budgetReservationId = null
	    }
	    await actGeneratingMessageService.fail({
      conversationId: actWebhookConversationId,
      emitWebhook: !actWebhookSkip,
      error,
      messageId: pendingGeneratingMessageId,
      turnId: actWebhookTurnId,
      userId: currentResourceUserId,
    })
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
    if (type === 'skill') capabilityRequirements.add('skills.use')
    if (type === 'mcp') capabilityRequirements.add('mcp.use')
    if (type === 'automation') capabilityRequirements.add('automations.use')
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
