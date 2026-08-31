import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import {
  getBillingProgrammaticSubjectId,
  getTrustedAutomationBillingSubjectId,
  type AppApiRouteContext,
} from '@/server/app-api/bff-context'
import { BrowserUse } from 'browser-use-sdk/v3'
import type { ProxyCountryCode } from 'browser-use-sdk/v3'
import { getOverlayServerContext } from '@/server/bootstrap'
import { outputService } from '@/server/outputs/http'
import { BROWSER_USE_TASK_INIT_USD, calculateBrowserUseV3TokenCost } from '@/server/ai/pricing'
import {
  buildInsufficientCreditsPayload,
  billableBudgetCentsFromProviderUsd,
  getBudgetTotals,
  isPaidPlan,
} from '@/server/billing/billing-runtime'
import {
  acquireConcurrentRequestSlot,
  concurrentRequestLimitResponse,
} from '@/server/security/concurrent-request-limiter'

export const maxDuration = 300

function parseUsd(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  let concurrencySlot: { release: () => void } | null = null
  try {
    const { task, sessionId, keepAlive, model, proxyCountryCode, conversationId, turnId }: {
      task?: string
      sessionId?: string
      keepAlive?: boolean
      model?: 'bu-mini' | 'bu-max'
      proxyCountryCode?: string
      conversationId?: string
      turnId?: string
    } = await request.json()

    const { auth } = context
    const workspaceId = context.workspace.workspace.id
    const programmaticSubjectId = getBillingProgrammaticSubjectId(
      context,
      getTrustedAutomationBillingSubjectId(context),
    )

    // Per-user concurrent request limit. Browser tasks can run for up to 300
    // seconds; without a concurrency cap, a user could fire multiple parallel
    // tasks and consume significant resources.
    concurrencySlot = acquireConcurrentRequestSlot(auth.userId, {
      bucket: 'browser-task',
      maxConcurrent: 2,
      maxDurationMs: 360_000, // 6 minutes (covers maxDuration=300s + buffer)
    })
    if (!concurrencySlot) {
      return concurrentRequestLimitResponse('browser-task')
    }

    const requestedSessionId = sessionId?.trim()
    if (requestedSessionId) {
      logger.warn('[Browser Task API] Ignoring requested session reuse during security hardening', {
        userId: auth.userId,
      })
    }

    if (!task?.trim()) {
      return NextResponse.json({ error: 'Task is required' }, { status: 400 })
    }
    if (model !== undefined && model !== 'bu-mini' && model !== 'bu-max') {
      return NextResponse.json(
        { error: 'model_not_allowed', message: 'Unsupported Browser Use model.' },
        { status: 400 },
      )
    }
    // Browser Use 3.11 widened its model catalog and changed the service default.
    // Keep Overlay's supported model boundary and historical default explicit so
    // fallback billing always uses a model with known pricing.
    const browserUseModel: 'bu-mini' | 'bu-max' = model ?? 'bu-mini'
    const MAX_TASK_LENGTH = 4096
    const sanitizedTask = task.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, MAX_TASK_LENGTH)
    if (!sanitizedTask) {
      return NextResponse.json({ error: 'Task is required' }, { status: 400 })
    }

    const apiKey = process.env.BROWSER_USE_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'browser_use_not_configured', message: 'Browser Use is not configured on the server.' },
        { status: 500 },
      )
    }

    const { generationUsagePolicy } = getOverlayServerContext()
    const entitlements = await generationUsagePolicy.getEntitlements({ programmaticSubjectId, userId: auth.userId, workspaceId })

    if (!entitlements) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Could not verify subscription. Try signing out and back in.' },
        { status: 401 },
      )
    }

    let currentEntitlements = entitlements
    let budget = getBudgetTotals(currentEntitlements)
    const taskInitCents = billableBudgetCentsFromProviderUsd(BROWSER_USE_TASK_INIT_USD)

    if (!isPaidPlan(currentEntitlements)) {
      return NextResponse.json(
        { error: 'generation_not_allowed', message: 'Browser browsing requires a paid plan.' },
        { status: 403 },
      )
    }
    if (budget.remainingCents <= taskInitCents) {
      const autoTopUp = await generationUsagePolicy.ensureBudgetAvailable({
        userId: auth.userId,
        entitlements: currentEntitlements,
        minimumRequiredCents: taskInitCents + 1,
        programmaticSubjectId,
        workspaceId,
      })
      currentEntitlements = autoTopUp.entitlements
      budget = getBudgetTotals(currentEntitlements)
    }
    const remainingVariableBudgetUsd = Math.max(0, budget.remainingCents / 100 / 1.25 - BROWSER_USE_TASK_INIT_USD)
    // Cap per-task cost to limit the number of browser actions a single task
    // can perform. Without this, a task with a large remaining budget could
    // run hundreds of browser iterations even though each is individually cheap.
    const MAX_BROWSER_TASK_VARIABLE_USD = 2.00
    const cappedVariableBudgetUsd = Math.min(remainingVariableBudgetUsd, MAX_BROWSER_TASK_VARIABLE_USD)
    if (budget.remainingCents <= taskInitCents || cappedVariableBudgetUsd <= 0) {
      return NextResponse.json(
        buildInsufficientCreditsPayload(currentEntitlements, 'Not enough budget remaining to start a browser task.'),
        { status: 402 },
      )
    }

    const reservation = await generationUsagePolicy.reserve({
      userId: auth.userId,
      entitlements: currentEntitlements,
      idempotencyKey: context.requestIdempotencyKey,
      providerCostUsd: BROWSER_USE_TASK_INIT_USD + cappedVariableBudgetUsd,
      kind: 'generation',
      modelId: `browser-use/${browserUseModel}`,
      operationId: 'agent.browser-task',
      programmaticSubjectId,
      requestFingerprint: context.requestFingerprint,
      workspaceId,
    })
    if (!reservation.ok) {
      return NextResponse.json({ ...reservation.payload, error: reservation.code }, { status: reservation.status })
    }

    const client = new BrowserUse({ apiKey })
    const normalizedProxyCountryCode =
      typeof proxyCountryCode === 'string' && /^[a-z]{2}$/i.test(proxyCountryCode)
        ? (proxyCountryCode.toLowerCase() as ProxyCountryCode)
        : undefined
    let result: Awaited<ReturnType<typeof client.run>>
    try {
      await generationUsagePolicy.markStarted({
        userId: auth.userId,
        reservationId: reservation.reservationId,
      })
      result = await client.run(sanitizedTask, {
        ...(typeof keepAlive === 'boolean' ? { keepAlive } : {}),
        model: browserUseModel,
        ...(normalizedProxyCountryCode ? { proxyCountryCode: normalizedProxyCountryCode } : {}),
        maxCostUsd: cappedVariableBudgetUsd,
      })
    } catch (err) {
      await generationUsagePolicy.release({
        userId: auth.userId,
        reservationId: reservation.reservationId,
        reason: err instanceof Error ? err.message : 'browser_task_failed',
      }).catch((_error) => undefined)
      throw err
    }

    const llmCostUsd = parseUsd(result.llmCostUsd)
    const proxyCostUsd = parseUsd(result.proxyCostUsd)
    const browserCostUsd = parseUsd(result.browserCostUsd)
    const reportedVariableCostUsd = parseUsd(result.totalCostUsd)
    const estimatedVariableCostUsd =
      reportedVariableCostUsd > 0
        ? reportedVariableCostUsd
        : calculateBrowserUseV3TokenCost(
            browserUseModel,
            result.totalInputTokens ?? 0,
            result.totalOutputTokens ?? 0,
          ) + proxyCostUsd + browserCostUsd
    const totalChargeUsd = BROWSER_USE_TASK_INIT_USD + estimatedVariableCostUsd
    const costCents = billableBudgetCentsFromProviderUsd(totalChargeUsd)

    await generationUsagePolicy.finalize({
      userId: auth.userId,
      reservationId: reservation.reservationId,
      actualProviderCostUsd: totalChargeUsd,
      events: [{
        type: 'generation',
        modelId: `browser-use/${result.model}`,
        inputTokens: result.totalInputTokens ?? 0,
        outputTokens: result.totalOutputTokens ?? 0,
        cachedTokens: 0,
        cost: costCents,
        timestamp: Date.now(),
      }],
    }).catch(async (err) => {
      await generationUsagePolicy.markForReconcile({
        userId: auth.userId,
        reservationId: reservation.reservationId,
        errorMessage: err instanceof Error ? err.message : 'finalize_failed',
      }).catch((_error) => undefined)
    })

    const updated = await generationUsagePolicy.getEntitlements({ programmaticSubjectId, userId: auth.userId, workspaceId })

    const outputText = typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result.output ?? '')
    const outputId = await outputService.create({
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
      type: 'text',
      source: 'browser',
      status: 'completed',
      prompt: sanitizedTask,
      modelId: `browser-use/${result.model}`,
      content: outputText,
      fileName: `browser-task-${Date.now()}.txt`,
      mimeType: 'text/plain',
      metadata: {
        browserSessionId: result.id,
        liveUrl: result.liveUrl ?? null,
        status: result.status,
      },
      ...(conversationId ? { conversationId } : {}),
      ...(turnId ? { turnId } : {}),
    })

    return NextResponse.json({
      output: result.output,
      outputId,
      sessionId: result.id,
      liveUrl: result.liveUrl ?? null,
      status: result.status,
      costUsd: totalChargeUsd.toFixed(4),
      billing: {
        taskInitUsd: BROWSER_USE_TASK_INIT_USD.toFixed(4),
        variableUsd: estimatedVariableCostUsd.toFixed(4),
        llmUsd: llmCostUsd.toFixed(4),
        proxyUsd: proxyCostUsd.toFixed(4),
        browserUsd: browserCostUsd.toFixed(4),
        reportedTotalUsd: reportedVariableCostUsd.toFixed(4),
        billedCents: costCents,
        maxCostUsd: cappedVariableBudgetUsd.toFixed(4),
        remainingCreditsCents:
          updated
            ? (updated.budgetRemainingCents ?? updated.creditsTotal * 100 - updated.creditsUsed)
            : undefined,
      },
    })
  } catch (error) {
    logger.error('[Browser Task API] Error:', error)
    const message = error instanceof Error ? error.message : 'Browser task failed'
    return NextResponse.json({ error: 'browser_task_failed', message }, { status: 500 })
  } finally {
    concurrencySlot?.release()
  }
}
