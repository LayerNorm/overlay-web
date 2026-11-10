import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getBillingProgrammaticSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { generateObject } from '@/server/ai/sdk'
import { z } from 'zod/v3'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { getOverlayServerContext } from '@/server/bootstrap'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import {
  chargeProviderUsage,
  ensureProviderBudgetNotLow,
  isPaidPlan,
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
    const workspaceId = context.workspace.workspace.id
    const programmaticSubjectId = getBillingProgrammaticSubjectId(context)

    const fallback = fallbackLabel(text)


    const entitlements = await getOverlayServerContext().generationUsagePolicy.getEntitlements({
      programmaticSubjectId,
      userId: auth.userId,
      workspaceId,
    })
    if (!entitlements || !isPaidPlan(entitlements)) {
      return NextResponse.json({ title: fallback })
    }

    const userPrompt = `Give a very short Chrome tab group name (at most 3 words, no punctuation) summarizing:\n\n${text.slice(0, 400)}`
    const check = await ensureProviderBudgetNotLow({
      userId: auth.userId,
      entitlements,
      kind: 'generation',
      modelId: TAB_GROUP_MODEL,
      operationId: 'chat.generate-tab-group-label',
      programmaticSubjectId,
      workspaceId,
    })
    if (!check.ok) return NextResponse.json({ title: fallback })

    let label = ''
    try {
      const model = await getLanguageModel(TAB_GROUP_MODEL, auth.accessToken, auth.userId)
      const result = await generateObject({
        model,
        schema: tabGroupLabelSchema,
        instructions:
          'You label Chrome tab groups. Return a title that is 1 to 3 words only, no quotes or trailing punctuation.',
        prompt: userPrompt,
        temperature: 0,
        maxOutputTokens: 32,
      })
      label = result.object.title
      const usage = (result as unknown as { usage?: { inputTokens?: number; outputTokens?: number } }).usage
      const inputTokens = usage?.inputTokens ?? 0
      const outputTokens = usage?.outputTokens ?? 0
      const providerCostUsd = await calculateLanguageModelTokenCostOrNull(TAB_GROUP_MODEL, inputTokens, 0, outputTokens)
      if (providerCostUsd === null) {
        logger.error('[TabGroupLabel] Missing pricing for completed provider call', { modelId: TAB_GROUP_MODEL })
      } else {
        await chargeProviderUsage({
          userId: auth.userId,
          workspaceId,
          programmaticSubjectId,
          operationId: `chat.generate-tab-group-label:${globalThis.crypto.randomUUID()}`,
          providerCostUsd,
          usage: { kind: 'generation', modelId: TAB_GROUP_MODEL, inputTokens, outputTokens, cachedTokens: 0 },
        }).catch((err) => logger.error('[TabGroupLabel] Failed to record usage', err))
      }
    } catch (_err) {
      // A failed call charges nothing.
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
