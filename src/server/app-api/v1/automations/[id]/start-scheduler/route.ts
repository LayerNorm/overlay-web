import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { start } from 'workflow/api'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationService } from '@/server/automations/http'
import { buildServiceAuthToken, getServiceAuthHeaderName } from '@/server/auth/service-auth'
import { getInternalApiBaseUrl } from '@/server/web/app-url'
import { logger } from '@/server/observability/logger'
import {
  automationScheduleWorkflow,
  type AutomationScheduleWorkflowInput,
} from '@/workflows/automation-schedule'

// ---------------------------------------------------------------------------
// POST /api/v1/automations/{id}/start-scheduler
//
// Starts the sleep()-based scheduling workflow for an enabled automation.
// The workflow loops: sleep until next run → execute → sleep again.
// Called automatically when an automation is enabled (or re-enabled).
//
// To stop the scheduler, cancel the workflow run (via the workflow API or
// by disabling the automation, which triggers a cancel-scheduler call).
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest, context?: AppApiRouteContext) {
  try {
    const automationId = (await context?.params ?? {})['id'] as string | undefined
    if (!automationId) {
      return NextResponse.json({ error: 'Automation ID is required' }, { status: 400 })
    }

    if (!context?.auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = context.auth.userId

    const automation = await automationService.getAutomationForExecution({
      automationId,
      userId,
    })
    if (!automation) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
    }

    const baseUrl = getInternalApiBaseUrl(request)
    const executePath = '/api/v1/automations/execute'
    const actPath = '/api/v1/conversations/act'
    const serviceToken = await buildServiceAuthToken({ userId, method: 'POST', path: executePath })
    const actServiceToken = await buildServiceAuthToken({ userId, method: 'POST', path: actPath })
    const finalizeServiceToken = await buildServiceAuthToken({ userId, method: 'PATCH', path: executePath })
    const serviceAuthHeader = getServiceAuthHeaderName()

    const { getOverlayServerContext } = await import('@/server/bootstrap')
    const workspace = await getOverlayServerContext().workspaceService.resolveActiveWorkspace(userId)

    const schedule = (automation as { schedule?: AutomationScheduleWorkflowInput['schedule'] }).schedule ??
      { kind: 'interval' as const, intervalMinutes: 60 }

    const workflowInput: AutomationScheduleWorkflowInput = {
      automationId,
      userId,
      name: (automation as { name?: string }).name ?? 'Untitled automation',
      description: (automation as { description?: string }).description ?? '',
      instructions: (automation as { instructions?: string }).instructions ?? '',
      projectId: (automation as { projectId?: string }).projectId,
      modelId: (automation as { modelId?: string }).modelId,
      conversationId: (automation as { conversationId?: string; sourceConversationId?: string }).conversationId ??
        (automation as { sourceConversationId?: string }).sourceConversationId,
      schedule,
      oneShot: false,
      baseUrl,
      serviceAuthHeader,
      serviceToken,
      actServiceToken,
      finalizeServiceToken,
      workspaceId: workspace.workspace.id,
    }

    const workflowRun = await start(automationScheduleWorkflow, [workflowInput])

    // Store the scheduler workflow run ID on the automation record
    await automationService.updateRunWorkflowRunId({
      runId: automationId, // Use automationId as the key for scheduler runs
      workflowRunId: workflowRun.runId,
    }).catch(() => {
      // Non-fatal — the scheduler is running even if we can't store the ID
      logger.warn('[automations/[id]/start-scheduler] Could not store workflow run ID', {
        automationId,
        workflowRunId: workflowRun.runId,
      })
    })

    return NextResponse.json({
      ok: true,
      automationId,
      workflowRunId: workflowRun.runId,
      scheduler: true,
    })
  } catch (error) {
    logger.error('[automations/[id]/start-scheduler]', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to start scheduler', message },
      { status: 500 },
    )
  }
}
