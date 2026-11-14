/**
 * Automation run workflow — the one durable execution path for every
 * automation run, scheduled or manual.
 *
 * Convex owns scheduling: its minute cron claims due runs and asks the app to
 * start this workflow for each one (POST /api/v1/automations/run). Manual runs
 * start it from POST /api/v1/automations/{id}/run. Either way there is an
 * automationRuns row first, and the run ID is the only key: the turn ID is
 * derived from it (automationRunTurnId) and the workflow settles the row.
 *
 * Runs are pinned to the deployment that started them, so changing this file
 * never affects runs already in flight.
 *
 * Inspect: npx workflow web
 */

import { createHook, FatalError, getWorkflowMetadata, sleep } from 'workflow'
import { automationRunTurnId } from '@/shared/automations/run-identity'
import { settleDeniedAutomationRun } from './automation-harness-steps'
import { runAutomationAgentTurn } from './automation-agent-turn'

export type AutomationRunWorkflowInput = {
  automationId: string
  runId: string
  userId: string
  name: string
  description: string
  instructions: string
  modelId?: string
  conversationId?: string
  workspaceId?: string
  /** When the run was due (scheduled) or requested (manual). */
  scheduledFor: number
  /** Set when the run must wait for approval before it executes. */
  approvalToken?: string
  /** How long to wait for approval before the run is skipped. */
  approvalTimeoutMs?: number
}

const DENIED_REASON = 'Approval was denied or timed out before automation execution.'

export async function automationRunWorkflow(input: AutomationRunWorkflowInput) {
  'use workflow'

  if (input.approvalToken && !await waitForApproval(input.approvalToken, input.approvalTimeoutMs)) {
    const { workflowRunId } = getWorkflowMetadata()
    const settled = await settleDeniedAutomationRun({
      automationId: input.automationId,
      runId: input.runId,
      userId: input.userId,
      workflowRunId,
      reason: DENIED_REASON,
    })
    if (!settled) throw new FatalError('Denied automation run could not be settled by its owner.')
    return { automationId: input.automationId, runId: input.runId, completed: false, skipped: true, reason: DENIED_REASON }
  }

  const result = await runAutomationAgentTurn({
    automationId: input.automationId,
    runId: input.runId,
    userId: input.userId,
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    modelId: input.modelId,
    conversationId: input.conversationId,
    turnId: automationRunTurnId(input.runId),
    scheduledFor: input.scheduledFor,
    workspaceId: input.workspaceId,
  })
  return {
    automationId: input.automationId,
    runId: input.runId,
    completed: result.status === 'completed',
    status: result.status,
  }
}

// Suspends the workflow until POST /api/v1/automations/{id}/approve resumes
// the hook, or the timeout passes.
async function waitForApproval(token: string, timeoutMs?: number): Promise<boolean> {
  const hook = createHook<{ approved: boolean; reason?: string }>({ token })
  try {
    if (timeoutMs && timeoutMs > 0) {
      const result = await Promise.race([hook, sleep(timeoutMs).then(() => null)])
      return result !== null && result.approved !== false
    }
    const result = await hook
    return result.approved !== false
  } catch (_error) {
    return false
  } finally {
    hook.dispose()
  }
}
