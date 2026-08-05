import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { start } from 'workflow/api'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationService } from '@/server/automations/http'
import { buildServiceAuthToken, getServiceAuthHeaderName } from '@/server/auth/service-auth'
import { getInternalApiBaseUrl } from '@/server/web/app-url'
import { logger } from '@/server/observability/logger'
import { automationRunWorkflow, type AutomationRunWorkflowInput } from '@/workflows/automation-run'

// ---------------------------------------------------------------------------
// POST /api/v1/automations/{id}/run
//
// Triggers a durable automation run via the Vercel Workflow SDK.
// When the `durableAutomations` feature flag is disabled, falls back to the
// existing test endpoint which handles the full run lifecycle.
// ---------------------------------------------------------------------------

function isDurableAutomationsEnabled(): boolean {
  return process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS === '1' ||
    process.env.OVERLAY_FEATURE_DURABLE_AUTOMATIONS === 'true'
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
    const path = '/api/v1/automations/execute'
    const serviceToken = await buildServiceAuthToken({ userId, method: 'POST', path })
    const serviceAuthHeader = getServiceAuthHeaderName()

    const turnId = `automation-${runId}-${Date.now()}`

    const workflowInput: AutomationRunWorkflowInput = {
      runId,
      userId,
      automationId,
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
      turnId,
      scheduledFor: Date.now(),
      baseUrl,
      serviceAuthHeader,
      serviceToken,
    }

    const workflowRun = await start(automationRunWorkflow, [workflowInput])

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
