import { logger } from '@/server/observability/logger'
import { after, NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { readValidatedJson } from '@/server/app-api/validated-input'
import { convertToModelMessages, generateText, stepCountIs, ToolLoopAgent, type UIMessage } from '@/server/ai/sdk'
import type { LanguageModelV3 } from '@/server/ai/provider-types'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import {
  assertUserCanUseByokModel,
  getLanguageModel,
  getGatewayModelId,
  getOpenRouterLanguageModelCapturingRoutedModel,
} from '@/server/ai/model-runtime'
import { modelSupportsZeroDataRetention } from '@/shared/ai/gateway/model-data'
import { getChatModelFallbackCandidates } from '@/shared/ai/gateway/model-fallbacks'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { userFacingOpenRouterError } from '@/server/ai/model-runtime'
import {
  FREE_TIER_AUTO_MODEL_ID,
  FREE_TIER_DEFAULT_MODEL_ID,
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
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
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

export const maxDuration = 800

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  const requestId = request.headers.get('x-request-id')?.trim() || crypto.randomUUID()
  let pendingGeneratingMessageId: Id<'conversationMessages'> | undefined
  let budgetReservationId: string | null = null
  let budgetReservationFinalized = false
  let currentUserId: string | undefined
  let actWebhookConversationId: Id<'conversations'> | undefined
  let actWebhookTurnId: string | undefined
  let actWebhookSkip = false
  let requestModelId: string | undefined
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
    currentUserId = userId
    const accessToken = auth.accessToken || undefined
    const effectiveModelId = resolveEffectiveActModelId(modelId)
    requestModelId = effectiveModelId
    const serverSecret = getInternalApiSecret()
    const requestedToolIds = normalizeChatToolRequestIds(rawRequestedToolIds)
    const memoryEnabled = rawMemoryEnabled !== false
    const {
      appSettings,
      paid,
      runtimeEntitlements,
    } = await actEntitlementService.gateModelAccess({
      effectiveModelId,
      userId,
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
        userId,
        repository: actConversationRepository,
        conversationClientId: trimmedClientId,
        entitlements: runtimeEntitlements,
        projectId,
        askModelIds,
        actModelId: effectiveModelId,
      })
      if (_ttftDebug) _tEnsureConversationMs = performance.now() - ensureStartedAt
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
      userId,
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
	      requestIdempotencyKey: context.requestIdempotencyKey!,
	      requestFingerprint: context.requestFingerprint,
	      serverSecret,
      userId,
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
        idempotencyKey: context.requestIdempotencyKey,
        operationId: 'conversation.act.media-intent',
        requestFingerprint: context.requestFingerprint,
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
      userId,
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
      userId,
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
	        userId,
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
          userId,
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
        return isByokModelId(attemptModelId)
          ? userFacingByokError(error)
          : userFacingOpenRouterError(error)
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
    if (responseBody) {
      // Persistent chats keep a server-side reader so generation and message
      // persistence continue if the browser disconnects. Temporary chats have
      // no conversation id and stream only to the connected client.
      if (isPostgresAppData || Boolean(cid)) {
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
              userId,
            })
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
        idempotencyKey: context.requestIdempotencyKey,
        modelId: attemptModelId,
        paid,
        estimatedInputTokens,
        maxOutputTokens,
        operationId: 'conversation.act',
        requestFingerprint: context.requestFingerprint,
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

      return getLanguageModel(attemptModelId, accessToken, userId)
    }

    const fallbackModelIds = (byokRequest ? [] : getChatModelFallbackCandidates({
      modelId: effectiveModelId,
      paid,
      onlyAllowZdrModels: paid && appSettings?.onlyAllowZdrModels === true,
      requiresVision: messagesRequireVision(uiMessages),
      maxCandidates: MAX_ACT_MODEL_ATTEMPTS - 1,
    })).filter((candidateId) => authorizedModelIds.chat.has(candidateId))
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
      userId: currentUserId,
    })
    return NextResponse.json(
      {
        error: requestModelId && isByokModelId(requestModelId)
          ? userFacingByokError(error)
          : userFacingOpenRouterError(error),
        requestId,
      },
      { status: 500, headers: { 'x-request-id': requestId } },
    )
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
