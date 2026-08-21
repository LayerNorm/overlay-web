import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getBillingProgrammaticSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { generateText } from '@/server/ai/sdk'
import { sanitizeChatTitle } from '@/shared/chat/chat-title'
import { getLanguageModel } from '@/server/ai/model-runtime'
import {
  canUsePaidBudgetFeatures,
} from '@/server/billing/billing-runtime'
import type { Entitlements } from '@overlay/billing'

/**
 * Title models in priority order, both served by the Vercel AI Gateway (ids
 * without a catalog entry pass straight through to the gateway).
 *
 * The first is free, so titles keep working on plans with no paid budget — the
 * old single-model route reserved paid budget for every title and returned null
 * for everyone else, which is why chats stayed "New Chat".
 */
const TITLE_MODELS: ReadonlyArray<{ id: string; free: boolean }> = [
  { id: 'poolside/laguna-s-2.1-free', free: true },
  { id: 'deepseek/deepseek-v4-flash', free: false },
]
const FALLBACK_TITLE = 'New Chat'
const MAX_PROMPT_CHARS = 1200
const ESTIMATED_OUTPUT_TOKENS = 32

const TITLE_INSTRUCTIONS =
  'You write short chat titles. Reply with the title only — 3 to 6 words, natural title case, ' +
  'no surrounding quotes, no trailing punctuation, no preamble. Capture the actual topic, not the first words.'

/** Models sometimes wrap the title in quotes or prefix it; keep the first meaningful line. */
function extractTitle(raw: string): string {
  const line = raw
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.length > 0) ?? ''
  return line
    .replace(/^(title|chat title)\s*[:\-–]\s*/i, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .trim()
}

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
    const canUsePaidModels = canUsePaidBudgetFeatures(entitlements)

    const prompt = `Generate a concise title for a conversation that starts with this message:\n\n${text.slice(0, MAX_PROMPT_CHARS)}`
    const estimatedInputTokens = Math.ceil(Math.min(text.length, MAX_PROMPT_CHARS) / 4) + 80

    let lastFailure: unknown = null
    for (const model of TITLE_MODELS) {
      if (!model.free && !canUsePaidModels) continue
      const title = await generateTitleWithModel({
        canUsePaidModels,
        chatUsagePolicy,
        context,
        entitlements,
        estimatedInputTokens,
        model,
        programmaticSubjectId,
        prompt,
        workspaceId,
      }).catch((error) => {
        lastFailure = error
        logger.warn('[ChatTitle][server] Title model failed', { modelId: model.id, error })
        return null
      })
      if (title) return NextResponse.json({ title })
    }

    if (lastFailure) {
      return NextResponse.json({ error: 'Failed to generate title' }, { status: 502 })
    }
    return NextResponse.json({ title: null })
  } catch (error) {
    logger.error('[ChatTitle][server] Failed to generate title', error)
    return NextResponse.json({ error: 'Failed to generate title' }, { status: 500 })
  }
}

async function generateTitleWithModel({
  canUsePaidModels,
  chatUsagePolicy,
  context,
  entitlements,
  estimatedInputTokens,
  model,
  programmaticSubjectId,
  prompt,
  workspaceId,
}: {
  canUsePaidModels: boolean
  chatUsagePolicy: ReturnType<typeof getOverlayServerContext>['chatUsagePolicy']
  context: AppApiRouteContext
  entitlements: Entitlements
  estimatedInputTokens: number
  model: { id: string; free: boolean }
  programmaticSubjectId?: string
  prompt: string
  workspaceId: string
}): Promise<string | null> {
  const { auth } = context
  const reservation = await chatUsagePolicy.reserveForAttempt({
    entitlements,
    estimatedInputTokens,
    idempotencyKey: context.requestIdempotencyKey,
    maxOutputTokens: ESTIMATED_OUTPUT_TOKENS,
    modelId: model.id,
    operationId: 'chat.generate-title',
    paid: !model.free && canUsePaidModels,
    requestFingerprint: context.requestFingerprint,
    programmaticSubjectId,
    userId: auth.userId,
    workspaceId,
  })
  if (!reservation.ok) return null

  const languageModel = await getLanguageModel(model.id, auth.accessToken)
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
      maxOutputTokens: ESTIMATED_OUTPUT_TOKENS,
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
    logger.warn('[ChatTitle][server] Model returned an empty title', { modelId: model.id })
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
    modelId: model.id,
    outputTokens: usage?.outputTokens ?? ESTIMATED_OUTPUT_TOKENS,
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
