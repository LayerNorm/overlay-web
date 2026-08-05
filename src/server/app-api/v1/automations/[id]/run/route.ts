import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { start } from 'workflow/api'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationService } from '@/server/automations/http'
import { buildServiceAuthToken, getServiceAuthHeaderName } from '@/server/auth/service-auth'
import { getInternalApiBaseUrl } from '@/server/web/app-url'
import { logger } from '@/server/observability/logger'
import { automationRunWorkflow, type AutomationRunWorkflowInput } from '@/workflows/automation-run'
import { automationScheduleWorkflow, type AutomationScheduleWorkflowInput, buildApprovalToken } from '@/workflows/automation-schedule'

// ---------------------------------------------------------------------------
// POST /api/v1/automations/{id}/run
//
// Triggers a durable automation run via the Vercel Workflow SDK.
// When the `durableAutomations` feature flag is disabled, falls back to the
// existing test endpoint which handles the full run lifecycle.
// ---------------------------------------------------------------------------

export function isDurableAutomationsEnabled(): boolean {
  // Env var override takes precedence (allows opt-in/out per deployment)
  const raw = process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  // Fall back to the app-shell feature flag config
  try {
    const { default: overlayAppConfig } = require('@/overlay.config')
    const { resolveOverlayAppShellConfig } = require('@overlay/app-core')
    const shell = resolveOverlayAppShellConfig(overlayAppConfig, {})
    const flag = shell.featureFlags.find((f: { id: string; enabled: boolean }) => f.id === 'durableAutomations')
    return flag?.enabled ?? false
  } catch {
    return false
  }
}

export async function POST(request: NextRequest, context?: AppApiRouteContext) {
  try {
    const automationId = (await context?.params ?? {})['id'] as string | undefined
    if (!automationId) {
      return NextResponse.json({ error: 'Automation ID is required' }, { status: 400 })
    }

    // Check auth — user auth required to trigger a run
    if (!context?.auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = context.auth.userId

    // Get automation details first (needed for both paths)
    const automation = await automationService.getAutomationForExecution({
      automationId,
      userId,
    })
    if (!automation) {
      return NextResponse.json(
        { error: 'Automation not found' },
        { status: 404 },
      )
    }

    if (!isDurableAutomationsEnabled()) {
      // Fallback: use the existing test endpoint which handles the full
      // lifecycle (create run → mark started → execute → mark completed).
      const baseUrl = getInternalApiBaseUrl(request)
      const result = await automationService.testAutomation({
        automationId,
        userId,
        baseUrl,
      })
      return NextResponse.json({
        ok: true,
        durable: false,
        ...result,
      })
    }

    // Durable path: create a manual run, then start the workflow
    const runId = await automationService.createManualRunForDurableExecution({
      automationId,
      userId,
    })
    if (!runId) {
      return NextResponse.json(
        { error: 'Failed to create automation run' },
        { status: 500 },
      )
    }

    const baseUrl = getInternalApiBaseUrl(request)
    const executePath = '/api/v1/automations/execute'
    const actPath = '/api/v1/conversations/act'
    const serviceToken = await buildServiceAuthToken({ userId, method: 'POST', path: executePath })
    const actServiceToken = await buildServiceAuthToken({ userId, method: 'POST', path: actPath })
    const finalizeServiceToken = await buildServiceAuthToken({ userId, method: 'PATCH', path: executePath })
    const serviceAuthHeader = getServiceAuthHeaderName()

    // Resolve the user's active workspace so the workflow can pass it
    // to the act route via the x-overlay-workspace-id header.
    const { getOverlayServerContext } = await import('@/server/bootstrap')
    const workspace = await getOverlayServerContext().workspaceService.resolveActiveWorkspace(userId)

    const turnId = `automation-${runId}-${Date.now()}`
    const now = Date.now()

    // Check if the automation graph has any condition nodes requiring approval
    const graph = (automation as { graph?: { nodes?: Array<{ kind: string }> } }).graph
    const hasConditionNode = graph?.nodes?.some(n => n.kind === 'condition') ?? false
    const approvalToken = hasConditionNode ? buildApprovalToken(automationId, now) : undefined

    // Use the scheduling workflow in one-shot mode for manual runs.
    // This unifies the execution path — the scheduling workflow handles both
    // one-shot and scheduled loop modes, plus optional approval hooks.
    const scheduleInput: AutomationScheduleWorkflowInput = {
      automationId,
      userId,
      name: (automation as { name?: string; title?: string }).name ||
        (automation as { title?: string }).title ||
        'Untitled automation',
      description: (automation as { description?: string }).description || '',
      instructions: (automation as { instructions?: string; instructionsMarkdown?: string }).instructions ||
        (automation as { instructionsMarkdown?: string }).instructionsMarkdown || '',
      projectId: (automation as { projectId?: string }).projectId,
      modelId: (automation as { modelId?: string }).modelId,
      conversationId: (automation as { conversationId?: string; sourceConversationId?: string }).conversationId ||
        (automation as { sourceConversationId?: string }).sourceConversationId,
      schedule: (automation as { schedule?: AutomationScheduleWorkflowInput['schedule'] }).schedule ??
        { kind: 'interval' as const, intervalMinutes: 60 },
      oneShot: true,
      approvalRequired: hasConditionNode,
      approvalToken,
      approvalTimeoutMs: 24 * 60 * 60_000, // 24h approval timeout
      baseUrl,
      serviceAuthHeader,
      serviceToken,
      actServiceToken,
      finalizeServiceToken,
      workspaceId: workspace.workspace.id,
    }

    const workflowRun = await start(automationScheduleWorkflow, [scheduleInput])

    // Store the workflow run ID on the automation run record
    await automationService.updateRunWorkflowRunId({
      runId,
      workflowRunId: workflowRun.runId,
    })

    return NextResponse.json({
      ok: true,
      runId,
      workflowRunId: workflowRun.runId,
      durable: true,
      ...(approvalToken ? { approvalToken, approvalRequired: true } : {}),
    })
  } catch (error) {
    logger.error('[automations/[id]/run]', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to start automation run', message },
      { status: 500 },
    )
  }
}
