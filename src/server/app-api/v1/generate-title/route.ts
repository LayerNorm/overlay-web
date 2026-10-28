import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getBillingProgrammaticSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { generateText } from '@/server/ai/sdk'
import { createRuntimeOverlayFreeLanguageModel } from '@/server/ai/gateway/overlay-free-router'
import { sanitizeChatTitle } from '@/shared/chat/chat-title'
import type { Entitlements } from '@overlay/billing'
import { FREE_TIER_AUTO_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { extractTitle } from './extract-title'
import { runTitleAttempts } from './title-attempts'

/**
 * Titles use the Auto free router, which falls back across the verified-free
 * AI Gateway and OpenRouter free models, so one unavailable free model no
 * longer leaves chats on "New Chat".
 */
const FALLBACK_TITLE = 'New Chat'
const MAX_PROMPT_CHARS = 1200
const MAX_OUTPUT_TOKENS = 512

const TITLE_INSTRUCTIONS =
  'You write short chat titles. Reply with the title only — 3 to 6 words, natural title case, ' +
  'no surrounding quotes, no trailing punctuation, no preamble. Capture the actual topic, not the first words.'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = (await request.json().catch((_error) => ({}))) as { text?: string }
    const { text } = body
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text required' }, { status: 400 })
    }

    const { auth } = context
    const workspaceId = context.workspace.workspace.id
    const programmaticSubjectId = getBillingProgrammaticSubjectId(context)
    const { chatUsagePolicy } = getOverlayServerContext()

    const entitlements = await chatUsagePolicy.getEntitlements({
      programmaticSubjectId,
      userId: auth.userId,
      workspaceId,
    })
    if (!entitlements) return NextResponse.json({ title: null })

    const prompt = `Generate a concise title for a conversation that starts with this message:\n\n${text.slice(0, MAX_PROMPT_CHARS)}`
    const estimatedInputTokens = Math.ceil(Math.min(text.length, MAX_PROMPT_CHARS) / 4) + 80

    const outcome = await runTitleAttempts(
      () => generateTitleWithModel({
        chatUsagePolicy,
        context,
        entitlements,
        estimatedInputTokens,
        programmaticSubjectId,
        prompt,
        workspaceId,
      }),
      {
        maxAttempts: 3,
        budgetMs: 12_000,
        onError: (error) => logger.warn('[ChatTitle][server] Title model failed', {
          modelId: FREE_TIER_AUTO_MODEL_ID,
          error,
        }),
      },
    )

    if (outcome.title !== null) return NextResponse.json({ title: outcome.title })
    if (outcome.failed) {
      return NextResponse.json({ error: 'Failed to generate title' }, { status: 502 })
    }
    return NextResponse.json({ title: null })
  } catch (error) {
    logger.error('[ChatTitle][server] Failed to generate title', error)
    return NextResponse.json({ error: 'Failed to generate title' }, { status: 500 })
  }
}

async function generateTitleWithModel({
  chatUsagePolicy,
  context,
  entitlements,
  estimatedInputTokens,
  programmaticSubjectId,
  prompt,
  workspaceId,
}: {
  chatUsagePolicy: ReturnType<typeof getOverlayServerContext>['chatUsagePolicy']
  context: AppApiRouteContext
  entitlements: Entitlements
  estimatedInputTokens: number
  programmaticSubjectId?: string
  prompt: string
  workspaceId: string
}): Promise<string | null> {
  const { auth } = context
  const modelId = FREE_TIER_AUTO_MODEL_ID
  const reservation = await chatUsagePolicy.reserveForAttempt({
    entitlements,
    estimatedInputTokens,
    idempotencyKey: context.requestIdempotencyKey,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    modelId,
    operationId: 'chat.generate-title',
    paid: false,
    requestFingerprint: context.requestFingerprint,
    programmaticSubjectId,
    userId: auth.userId,
    workspaceId,
  })
  if (!reservation.ok) return null

  let routedModelId: string | undefined
  const languageModel = await createRuntimeOverlayFreeLanguageModel({
    modelId: FREE_TIER_AUTO_MODEL_ID,
    onModelCaptured: (capturedModelId) => { routedModelId = capturedModelId },
  })
  let result: Awaited<ReturnType<typeof generateText>>
  try {
    await chatUsagePolicy.markReservationStarted({
      userId: auth.userId,
      reservationId: reservation.reservationId,
    })
    result = await generateText({
      model: languageModel,
      instructions: TITLE_INSTRUCTIONS,
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      prompt,
    })
  } catch (error) {
    await chatUsagePolicy.releaseReservation({
      userId: auth.userId,
      reservationId: reservation.reservationId,
      reason: error instanceof Error ? error.message : 'title_generation_failed',
    }).catch((releaseError) => logger.error('[ChatTitle][server] Failed to release reservation', releaseError))
    throw error
  }

  const sanitizedTitle = sanitizeChatTitle(extractTitle(result.text ?? ''), FALLBACK_TITLE)
  if (sanitizedTitle === FALLBACK_TITLE) {
    logger.warn('[ChatTitle][server] Model returned an empty title', {
      finishReason: result.finishReason,
      modelId,
      reasoningLength: result.reasoningText?.length ?? 0,
      routedModelId,
      textLength: result.text?.length ?? 0,
    })
    await chatUsagePolicy.markReservationForReconcile({
      userId: auth.userId,
      reservationId: reservation.reservationId,
      errorMessage: 'empty_title_after_provider_success',
    }).catch((_error) => undefined)
    return null
  }

  const usage = result.usage as { inputTokens?: number; outputTokens?: number } | undefined
  await chatUsagePolicy.recordFinishedUsage({
    forceFreeTierLimits: false,
    inputTokens: usage?.inputTokens ?? estimatedInputTokens,
    modelId,
    outputTokens: usage?.outputTokens ?? MAX_OUTPUT_TOKENS,
    reservationId: reservation.reservationId,
    userId: auth.userId,
  }).catch(async (error) => {
    logger.error('[ChatTitle][server] Failed to record usage', error)
    await chatUsagePolicy.markReservationForReconcile({
      userId: auth.userId,
      reservationId: reservation.reservationId,
      errorMessage: error instanceof Error ? error.message : 'usage_record_failed',
    }).catch((_error) => undefined)
  })

  return sanitizedTitle
}
