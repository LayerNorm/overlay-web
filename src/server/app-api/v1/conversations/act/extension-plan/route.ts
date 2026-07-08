import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { generateObject } from '@/server/ai/sdk'
import { z } from 'zod'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import {
  FREE_TIER_DEFAULT_MODEL_ID,
  isFreeTierChatModelId,
  isLegacyFreeTierDefaultModelId,
} from '@/shared/ai/gateway/model-types'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { isPremiumModel } from '@/server/ai/pricing'
import { getLanguageModel } from '@/server/ai/model-runtime'
import type { Entitlements } from '@/shared/app/app-contracts'
import {
  billableBudgetCentsFromProviderUsd,
  buildInsufficientCreditsPayload,
  canUsePaidBudgetFeatures,
  ensureBudgetAvailable,
  finalizeProviderBudgetReservation,
  getBudgetTotals,
  isPaidPlan,
  markProviderBudgetReconcile,
  releaseProviderBudgetReservation,
  reserveProviderBudget,
} from '@/server/billing/billing-runtime'

export const maxDuration = 120

const targetSchema = z.object({
  tabId: z.number().int().optional(),
  windowId: z.number().int().optional(),
  url: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
  coordinates: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
})

const tabIdSchema = z.object({
  tabId: z.number().int().optional(),
})

const toolRequestSchema = z.discriminatedUnion('toolName', [
  z.object({
    toolName: z.literal('tabs.list'),
    summary: z.string(),
    readOnly: z.boolean().default(true),
    args: z.object({}).default({}),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('tabs.open'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      url: z.string().url(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('tabs.focus'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: tabIdSchema,
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('tabs.close'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: tabIdSchema,
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('tabs.navigate'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      tabId: z.number().int().optional(),
      url: z.string().url(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('tabs.reload'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: tabIdSchema,
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('windows.list'),
    summary: z.string(),
    readOnly: z.boolean().default(true),
    args: z.object({}).default({}),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('windows.focus'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      windowId: z.number().int(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.inspect'),
    summary: z.string(),
    readOnly: z.boolean().default(true),
    args: tabIdSchema.default({}),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.find'),
    summary: z.string(),
    readOnly: z.boolean().default(true),
    args: z.object({
      query: z.string().optional(),
      selector: z.string().optional(),
      text: z.string().optional(),
      maxResults: z.number().int().min(1).max(10).optional(),
      tabId: z.number().int().optional(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.click'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      selector: z.string().optional(),
      text: z.string().optional(),
      index: z.number().int().min(0).optional(),
      tabId: z.number().int().optional(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.type'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      selector: z.string().optional(),
      text: z.string().optional(),
      value: z.string(),
      append: z.boolean().optional(),
      tabId: z.number().int().optional(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.press'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      key: z.string(),
      selector: z.string().optional(),
      text: z.string().optional(),
      tabId: z.number().int().optional(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.select'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      selector: z.string().optional(),
      text: z.string().optional(),
      value: z.string().optional(),
      label: z.string().optional(),
      tabId: z.number().int().optional(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.scroll'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      direction: z.enum(['up', 'down']).optional(),
      amount: z.number().optional(),
      behavior: z.enum(['smooth', 'instant']).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      tabId: z.number().int().optional(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.hover'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      selector: z.string().optional(),
      text: z.string().optional(),
      index: z.number().int().min(0).optional(),
      tabId: z.number().int().optional(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.wait_for'),
    summary: z.string(),
    readOnly: z.boolean().default(true),
    args: z.object({
      selector: z.string().optional(),
      text: z.string().optional(),
      timeoutMs: z.number().int().min(1).max(30000).optional(),
      tabId: z.number().int().optional(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.screenshot'),
    summary: z.string(),
    readOnly: z.boolean().default(true),
    args: z.object({
      fullPage: z.boolean().optional(),
      tabId: z.number().int().optional(),
    }).default({}),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.click_at'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      x: z.number(),
      y: z.number(),
      tabId: z.number().int().optional(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.move_mouse'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      x: z.number(),
      y: z.number(),
      tabId: z.number().int().optional(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('page.drag'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      startX: z.number(),
      startY: z.number(),
      endX: z.number(),
      endY: z.number(),
      tabId: z.number().int().optional(),
    }),
    target: targetSchema.optional(),
  }),
  z.object({
    toolName: z.literal('browser_run_task'),
    summary: z.string(),
    readOnly: z.boolean().default(false),
    args: z.object({
      task: z.string(),
    }),
    target: targetSchema.optional(),
  }),
])

const plannerSchema = z.object({
  assistantText: z.string().default(''),
  statusLabel: z.string().default(''),
  complete: z.boolean(),
  toolRequest: toolRequestSchema.nullable().default(null),
})

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch (_error) {
    return String(value)
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const {
      messages,
      modelId,
      pageContext,
      windowTabs,
      windows,
    }: {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      modelId?: string
      pageContext?: unknown
      windowTabs?: unknown[]
      windows?: unknown[]
    } = await request.json()

    const { auth } = context


    const requestedModelId: string = modelId || 'claude-sonnet-4-6'
    const effectiveModelId: string = isLegacyFreeTierDefaultModelId(requestedModelId)
      ? FREE_TIER_DEFAULT_MODEL_ID
      : requestedModelId
    const serverSecret = getInternalApiSecret()
    const entitlements = await convex.query<Entitlements>('platform/usage:getEntitlementsByServer', {
      serverSecret,
      userId: auth.userId,
    })

    if (!entitlements) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Could not verify subscription. Try signing out and back in.' },
        { status: 401 },
      )
    }

    let runtimeEntitlements = entitlements
    const budget = getBudgetTotals(runtimeEntitlements)

    if (isPaidPlan(runtimeEntitlements) && budget.remainingCents <= 0) {
      const autoTopUp = await ensureBudgetAvailable({
        userId: auth.userId,
        entitlements: runtimeEntitlements,
        minimumRequiredCents: 1,
      })
      runtimeEntitlements = autoTopUp.entitlements
    }

    const paid = canUsePaidBudgetFeatures(runtimeEntitlements)

    if (!paid && !isFreeTierChatModelId(effectiveModelId)) {
      if (isPaidPlan(runtimeEntitlements)) {
        return NextResponse.json(
          buildInsufficientCreditsPayload(runtimeEntitlements, 'No budget remaining. Switch to a free model or top up your account.'),
          { status: 402 },
        )
      }
      return NextResponse.json(
        { error: 'premium_model_not_allowed', message: 'Free tier is limited to free models. Upgrade to a paid plan to use premium models.' },
        { status: 403 },
      )
    }

    const model = await getLanguageModel(effectiveModelId, auth.accessToken)
    const transcript = (messages ?? [])
      .filter((message) => message && typeof message.content === 'string')
      .map((message, index) => `${index + 1}. ${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n')

    const prompt = [
      'You are the planner for the Overlay Chrome extension: you help the user both answer questions and control the browser.',
      'You do not execute tools yourself. Choose the single best next step based on the transcript and browser state.',
      'When the user only needs information, return complete=true with a direct answer in assistantText and no toolRequest.',
      'When browser interaction is needed, return complete=false with at most one toolRequest for the next step.',
      'Return complete=true only when the task is done and you can answer the user directly without further tools.',
      'Prefer local extension tools for the user’s current browser state. Use browser_run_task only if local tools are not enough.',
      'Use DOM-first tools before coordinate tools. Use coordinate tools only when selectors/text are not reliable.',
      'Read-only tools: tabs.list, windows.list, page.inspect, page.find, page.wait_for, page.screenshot.',
      'Mutating tools require approval: tabs.open, tabs.focus, tabs.close, tabs.navigate, tabs.reload, windows.focus, page.click, page.type, page.press, page.select, page.scroll, page.hover, page.click_at, page.move_mouse, page.drag.',
      'Tool argument guidance:',
      '- tabs.open args: { url }',
      '- tabs.focus/close/navigate/reload args: { tabId? , url? }',
      '- windows.focus args: { windowId }',
      '- page.find args: { query, selector?, maxResults? }',
      '- page.click args: { selector?, text?, index?, tabId? }',
      '- page.type args: { selector?, text?, value, append? }',
      '- page.press args: { key, selector?, text?, tabId? }',
      '- page.select args: { selector?, text?, value, label? }',
      '- page.scroll args: { direction?, amount?, behavior?, x?, y? }',
      '- page.hover args: { selector?, text?, index? }',
      '- page.wait_for args: { selector?, text?, timeoutMs? }',
      '- page.screenshot args: { fullPage? }',
      '- page.click_at/move_mouse args: { x, y }',
      '- page.drag args: { startX, startY, endX, endY }',
      '- browser_run_task args: { task }',
      'If the user rejected a prior action, adapt and choose a safer alternative if possible.',
      `Current timestamp: ${new Date().toISOString()}`,
      '',
      'Browser context:',
      stringifyJson({
        pageContext: pageContext ?? null,
        windowTabs: windowTabs ?? [],
        windows: windows ?? [],
      }),
      '',
      'Transcript:',
      transcript || 'No prior transcript.',
    ].join('\n')

    const estimatedInputTokens = Math.ceil(prompt.length / 4) + 256
    const maxOutputTokens = 1200
    let reservationId: string | null = null
    if (paid && isPremiumModel(effectiveModelId)) {
      const estimatedProviderCostUsd = await calculateLanguageModelTokenCostOrNull(
        effectiveModelId,
        estimatedInputTokens,
        0,
        maxOutputTokens,
      )
      if (estimatedProviderCostUsd === null) {
        return NextResponse.json(
          { error: 'pricing_missing', message: `Model ${effectiveModelId} is not priced for production use.` },
          { status: 400 },
        )
      }
      const reservation = await reserveProviderBudget({
        userId: auth.userId,
        entitlements: runtimeEntitlements,
        providerCostUsd: estimatedProviderCostUsd,
        kind: 'agent',
        modelId: effectiveModelId,
      })
      if (!reservation.ok) {
        return NextResponse.json({ ...reservation.payload, error: reservation.code }, { status: reservation.status })
      }
      reservationId = reservation.reservationId
    }

    let result: { object: z.infer<typeof plannerSchema>; usage?: { inputTokens?: number; outputTokens?: number } }
    try {
      result = await generateObject({
        model,
        schema: plannerSchema,
        prompt,
        temperature: 0.2,
        maxOutputTokens,
      })
    } catch (err) {
      await releaseProviderBudgetReservation({
        userId: auth.userId,
        reservationId,
        reason: err instanceof Error ? err.message : 'extension_planner_failed',
      }).catch((_error) => undefined)
      throw err
    }

    if (reservationId) {
      const usage = (result as unknown as { usage?: { inputTokens?: number; outputTokens?: number } }).usage
      const inputTokens = usage?.inputTokens ?? estimatedInputTokens
      const outputTokens = usage?.outputTokens ?? maxOutputTokens
      const actualCostUsd = await calculateLanguageModelTokenCostOrNull(
        effectiveModelId,
        inputTokens,
        0,
        outputTokens,
      )
      if (actualCostUsd === null) {
        await markProviderBudgetReconcile({
          userId: auth.userId,
          reservationId,
          errorMessage: `pricing_missing:${effectiveModelId}`,
        }).catch((_error) => undefined)
      } else {
        const costCents = billableBudgetCentsFromProviderUsd(actualCostUsd)
        await finalizeProviderBudgetReservation({
          userId: auth.userId,
          reservationId,
          actualProviderCostUsd: actualCostUsd,
          events: [{
            type: 'agent',
            modelId: effectiveModelId,
            inputTokens,
            outputTokens,
            cachedTokens: 0,
            cost: costCents,
            timestamp: Date.now(),
          }],
        }).catch(async (err) => {
          await markProviderBudgetReconcile({
            userId: auth.userId,
            reservationId,
            errorMessage: err instanceof Error ? err.message : 'finalize_failed',
          }).catch((_error) => undefined)
        })
      }
    }

    return NextResponse.json(result.object)
  } catch (error) {
    logger.error('[conversations/act/extension-plan] Failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to plan extension act step.'
    return NextResponse.json({ error: 'extension_act_planner_failed', message }, { status: 500 })
  }
}
