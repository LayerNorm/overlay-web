import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { generateObject } from '@/server/ai/sdk'
import { z } from 'zod'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { getOverlayServerContext } from '@/server/bootstrap'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import {
  billableBudgetCentsFromProviderUsd,
  finalizeProviderBudgetReservation,
  isPaidPlan,
  markProviderBudgetReconcile,
  releaseProviderBudgetReservation,
  reserveProviderBudget,
} from '@/server/billing/billing-runtime'

const TAB_GROUP_MODEL = 'openai/gpt-oss-20b'
const tabGroupLabelSchema = z.object({
  title: z.string().describe('Chrome tab group label, 1 to 3 words, no punctuation'),
})

function fallbackLabel(text: string): string {
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?!.,;:]+$/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
  return words.map((w) => w.replace(/^./, (c) => c.toUpperCase())).join(' ') || 'Overlay chat'
}

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

    const fallback = fallbackLabel(text)


    const entitlements = await getOverlayServerContext().generationUsagePolicy.getEntitlements({
      userId: auth.userId,
    })
    if (!entitlements || !isPaidPlan(entitlements)) {
      return NextResponse.json({ title: fallback })
    }

    const userPrompt = `Give a very short Chrome tab group name (at most 3 words, no punctuation) summarizing:\n\n${text.slice(0, 400)}`
    const estimatedInputTokens = Math.ceil(userPrompt.length / 4) + 80
    const estimatedOutputTokens = 32
    const estimatedCostUsd = await calculateLanguageModelTokenCostOrNull(TAB_GROUP_MODEL, estimatedInputTokens, 0, estimatedOutputTokens)
    if (estimatedCostUsd === null) {
      return NextResponse.json({ title: fallback })
    }
    const reservation = await reserveProviderBudget({
      userId: auth.userId,
      entitlements,
      providerCostUsd: estimatedCostUsd,
      kind: 'generation',
      modelId: TAB_GROUP_MODEL,
    })
    if (!reservation.ok) return NextResponse.json({ title: fallback })

    let label = ''
    try {
      const model = await getLanguageModel(TAB_GROUP_MODEL, auth.accessToken)
      const result = await generateObject({
        model,
        schema: tabGroupLabelSchema,
        system:
          'You label Chrome tab groups. Return a title that is 1 to 3 words only, no quotes or trailing punctuation.',
        prompt: userPrompt,
        temperature: 0,
        maxOutputTokens: 32,
      })
      label = result.object.title
      const usage = (result as unknown as { usage?: { inputTokens?: number; outputTokens?: number } }).usage
      const inputTokens = usage?.inputTokens ?? estimatedInputTokens
      const outputTokens = usage?.outputTokens ?? estimatedOutputTokens
      const actualCostUsd = await calculateLanguageModelTokenCostOrNull(TAB_GROUP_MODEL, inputTokens, 0, outputTokens)
      if (actualCostUsd === null) {
        await markProviderBudgetReconcile({
          userId: auth.userId,
          reservationId: reservation.reservationId,
          errorMessage: `pricing_missing:${TAB_GROUP_MODEL}`,
        }).catch((_error) => undefined)
      } else {
        const costCents = billableBudgetCentsFromProviderUsd(actualCostUsd)
        await finalizeProviderBudgetReservation({
          userId: auth.userId,
          reservationId: reservation.reservationId,
          actualProviderCostUsd: actualCostUsd,
          events: [{
            type: 'generation',
            modelId: TAB_GROUP_MODEL,
            inputTokens,
            outputTokens,
            cachedTokens: 0,
            cost: costCents,
            timestamp: Date.now(),
          }],
        }).catch(async (err) => {
          await markProviderBudgetReconcile({
            userId: auth.userId,
            reservationId: reservation.reservationId,
            errorMessage: err instanceof Error ? err.message : 'finalize_failed',
          }).catch((_error) => undefined)
        })
      }
    } catch (err) {
      await releaseProviderBudgetReservation({
        userId: auth.userId,
        reservationId: reservation.reservationId,
        reason: err instanceof Error ? err.message : 'tab_group_label_failed',
      }).catch((_error) => undefined)
      return NextResponse.json({ title: fallback })
    }

    const words = label
      .replace(/[.!?,;:]+$/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
    const sanitized = words.join(' ') || fallback

    return NextResponse.json({ title: sanitized })
  } catch (error) {
    logger.error('[TabGroupLabel] failed', error)
    return NextResponse.json({ error: 'Failed to generate label' }, { status: 500 })
  }
}
