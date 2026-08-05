import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { start } from 'workflow/api'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationService } from '@/server/automations/http'
import { buildServiceAuthToken, getServiceAuthHeaderName } from '@/server/auth/service-auth'
import { getInternalApiBaseUrl } from '@/server/web/app-url'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'
import { logger } from '@/server/observability/logger'
import { automationRunWorkflow, type AutomationRunWorkflowInput } from '@/workflows/automation-run'

// ---------------------------------------------------------------------------
// POST /api/v1/automations/{id}/run
//
// Triggers a durable automation run via the Vercel Workflow SDK.
// When the `durableAutomations` feature flag is disabled, falls back to the
// existing coordinator path (POST /api/v1/automations/run).
// ---------------------------------------------------------------------------

function isDurableAutomationsEnabled(): boolean {
  const capabilities = getOverlayCapabilitiesSync()
  // The feature flag is checked via the app shell registry. For now, we use
  // an env var override since the flag is not yet wired into capabilities.
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

    // Create a manual run record
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

    // Get automation details for the workflow input
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
      // Fallback: use the existing executor path
      const baseUrl = getInternalApiBaseUrl(request)
      const result = await automationService.runAutomation({
        runId,
        serviceUserId: userId,
        baseUrl,
      })
      return NextResponse.json({
        ok: true,
        runId,
        conversationId: result.conversationId,
        durable: false,
      })
    }

    // Durable path: start the workflow
    const baseUrl = getInternalApiBaseUrl(request)
    const path = '/api/v1/automations/execute'
    const serviceToken = await buildServiceAuthToken({ userId, method: 'POST', path })
    const serviceAuthHeader = getServiceAuthHeaderName()

    const turnId = `automation-${runId}-${Date.now()}`

    const workflowInput: AutomationRunWorkflowInput = {
      runId,
      userId,
      automationId,
      name: automation.name || automation.title || 'Untitled automation',
      description: automation.description || '',
      instructions: automation.instructions || automation.instructionsMarkdown || '',
      projectId: automation.projectId,
      modelId: automation.modelId,
      conversationId: automation.conversationId || automation.sourceConversationId,
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
