import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getBillingProgrammaticSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { generateObject } from '@/server/ai/sdk'
import { z } from 'zod'
import { sanitizeChatTitle } from '@/shared/chat/chat-title'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { getLanguageModel } from '@/server/ai/model-runtime'
import {
  canUsePaidBudgetFeatures,
} from '@/server/billing/billing-runtime'

const TITLE_MODEL = DEFAULT_MODEL_ID
const FALLBACK_TITLE = 'New Chat'

const titleSchema = z.object({
  title: z.string().describe('A concise chat title, 3 to 6 words, natural title case, no trailing punctuation'),
})

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = (await request.json().catch((_error) => ({}))) as {
      text?: string
    }
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
    if (!entitlements || !canUsePaidBudgetFeatures(entitlements)) {
      return NextResponse.json({ title: null })
    }

    const estimatedInputTokens = Math.ceil(Math.min(text.length, 1200) / 4) + 80
    const estimatedOutputTokens = 80
    const reservation = await chatUsagePolicy.reserveForAttempt({
      entitlements,
      estimatedInputTokens,
      idempotencyKey: context.requestIdempotencyKey,
      maxOutputTokens: estimatedOutputTokens,
      modelId: TITLE_MODEL,
      operationId: 'chat.generate-title',
      paid: true,
      requestFingerprint: context.requestFingerprint,
      programmaticSubjectId,
      userId: auth.userId,
      workspaceId,
    })
    if (!reservation.ok) {
      return NextResponse.json(reservation.failure.payload, { status: reservation.failure.statusCode })
    }

    const model = await getLanguageModel(TITLE_MODEL, auth.accessToken)
    let result: { object: z.infer<typeof titleSchema>; usage?: { inputTokens?: number; outputTokens?: number } }
    try {
      await chatUsagePolicy.markReservationStarted({
        userId: auth.userId,
        reservationId: reservation.reservationId,
      })
      result = await generateObject({
        model,
        schema: titleSchema,
        instructions:
          'You write short, precise chat titles. Capture the actual topic, not the first words.',
        temperature: 0.2,
        maxOutputTokens: 80,
        prompt: `Generate a concise title for a conversation that starts with this message:\n\n${text.slice(0, 1200)}`,
      })
    } catch (err) {
      await chatUsagePolicy.releaseReservation({
        userId: auth.userId,
        reservationId: reservation.ok ? reservation.reservationId : null,
        reason: err instanceof Error ? err.message : 'title_generation_failed',
      }).catch((releaseError) => logger.error('[ChatTitle][server] Failed to release reservation', releaseError))
      throw err
    }

    const extracted = result.object.title?.trim() ?? ''
    const sanitizedTitle = sanitizeChatTitle(extracted, FALLBACK_TITLE)
    if (sanitizedTitle === FALLBACK_TITLE) {
      logger.warn('[ChatTitle][server] Gateway returned empty title', result.object)
      await chatUsagePolicy.markReservationForReconcile({
        userId: auth.userId,
        reservationId: reservation.reservationId,
        errorMessage: 'empty_title_after_provider_success',
      }).catch((_error) => undefined)
      return NextResponse.json({ title: null }, { status: 502 })
    }

    const usage = (result as unknown as { usage?: { inputTokens?: number; outputTokens?: number } }).usage
    const inputTokens = usage?.inputTokens ?? estimatedInputTokens
    const outputTokens = usage?.outputTokens ?? estimatedOutputTokens
    await chatUsagePolicy.recordFinishedUsage({
      forceFreeTierLimits: false,
      inputTokens,
      modelId: TITLE_MODEL,
      outputTokens,
      reservationId: reservation.reservationId,
      userId: auth.userId,
    }).catch(async (err) => {
      logger.error('[ChatTitle][server] Failed to record usage', err)
      await chatUsagePolicy.markReservationForReconcile({
        userId: auth.userId,
        reservationId: reservation.reservationId,
        errorMessage: err instanceof Error ? err.message : 'usage_record_failed',
      }).catch((_error) => undefined)
    })

    return NextResponse.json({ title: sanitizedTitle })
  } catch (error) {
    logger.error('[ChatTitle][server] Failed to generate title', error)
    return NextResponse.json({ error: 'Failed to generate title' }, { status: 500 })
  }
}
