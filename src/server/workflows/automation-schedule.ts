/**
 * Automation Scheduling Workflow — sleep()-based scheduling that replaces
 * the 1-minute Convex cron polling.
 *
 * Instead of a cron job scanning for due automations every minute, this
 * workflow sleeps until the next scheduled run time, executes the automation,
 * computes the next run time, and sleeps again. The loop continues until
 * the automation is disabled, deleted, or the workflow is cancelled.
 *
 * Benefits over cron polling:
 *   - No drift: sleep() is exact (suspends until a specific timestamp)
 *   - Zero compute cost while sleeping (Vercel World handles suspension)
 *   - No polling overhead — each automation has its own workflow run
 *   - Cancellation is trivial: stop the workflow run
 *
 * The agent turn itself runs as an in-workflow `WorkflowAgent`
 * (see ./automation-agent-turn) — model calls, tool calls, persistence, and
 * billing are all durable steps rather than a self-HTTP call into the act
 * route that died with its request.
 *
 * Trigger: POST /api/v1/automations/{id}/run (when durableAutomations is enabled)
 * Cancel:  workflow run is stopped when automation is disabled or deleted
 * Inspect: npx workflow web
 */

import { sleep, FatalError, createHook } from "workflow"
import type { AutomationSchedule } from "@/shared/automations/schedule"
import { msUntilNextRun } from "@/shared/automations/schedule"
import {
  checkAutomationEnabled,
  runAutomationAgentTurn,
} from './automation-agent-turn'

export {
  buildAutomationUserMessage,
  buildAutomationSystemPrompt,
} from '@/shared/automations/automation-prompts'

export type AutomationScheduleWorkflowInput = {
  automationId: string
  userId: string
  name: string
  description: string
  instructions: string
  projectId?: string
  modelId?: string
  conversationId?: string
  schedule: AutomationSchedule
  /** If true, the workflow runs once and exits (manual trigger). */
  oneShot?: boolean
  /** If set, the workflow waits for approval via a hook before executing. */
  approvalRequired?: boolean
  /** Token for the approval hook — deterministic so external systems can resume. */
  approvalToken?: string
  /** Timeout in ms for approval. If not approved within this time, the run is skipped. */
  approvalTimeoutMs?: number
  baseUrl: string
  workspaceId?: string
  /** The automation_runs record ID — used to sync run status back to the database. */
  runId?: string
}

/**
 * Scheduling workflow — loops: sleep → (optional approval) → execute → repeat.
 *
 * For manual/one-shot runs, the loop executes once and exits.
 * For scheduled runs, the loop continues indefinitely until cancelled.
 */
export async function automationScheduleWorkflow(input: AutomationScheduleWorkflowInput) {
  "use workflow"

  if (input.oneShot) {
    // Manual run — execute immediately, no scheduling loop
    if (input.approvalRequired) {
      await waitForApproval(input)
    }
    await executeAutomationRun(input)
    return { automationId: input.automationId, completed: true }
  }

  // Scheduled loop — sleep until next run, execute, repeat
  for (;;) {
    // Compute sleep duration until next scheduled run
    const now = Date.now()
    const sleepMs = msUntilNextRun(input.schedule, now)

    await sleep(sleepMs)

    // Safety net: check if the automation is still enabled before executing.
    // This catches cases where the automation was disabled or deleted while
    // the workflow was sleeping, but the scheduler workflow wasn't cancelled
    // (e.g. after a deployment restart, or if the cancel call failed).
    const status = await checkAutomationEnabled({
      automationId: input.automationId,
      userId: input.userId,
    })
    if (!status.enabled || status.deleted) {
      return { automationId: input.automationId, completed: true, cancelled: true }
    }

    // Check for approval if required
    if (input.approvalRequired) {
      const approved = await waitForApproval(input)
      if (!approved) {
        // Approval timed out or was denied — skip this run, continue loop
        continue
      }
    }

    // Execute the automation run
    await executeAutomationRun(input)
  }
}

// ---------------------------------------------------------------------------
// Approval step — suspends workflow until external webhook resumes the hook
// ---------------------------------------------------------------------------

async function waitForApproval(input: AutomationScheduleWorkflowInput): Promise<boolean> {
  if (!input.approvalToken) {
    throw new FatalError("Approval required but no approval token provided")
  }

  const hook = createHook<{ approved: boolean; reason?: string }>({
    token: input.approvalToken,
  })

  // If a timeout is set, race the hook against a sleep
  if (input.approvalTimeoutMs && input.approvalTimeoutMs > 0) {
    try {
      const result = await Promise.race([
        hook,
        sleep(input.approvalTimeoutMs).then(() => null),
      ])
      if (result === null) {
        hook.dispose()
        return false // Timed out
      }
      return result.approved !== false
    } catch (_error) {
      hook.dispose()
      return false
    }
  }

  // No timeout — wait indefinitely for approval
  const result = await hook
  return result.approved !== false
}

// ---------------------------------------------------------------------------
// Execution — the agent turn runs as durable workflow steps (WorkflowAgent).
// ---------------------------------------------------------------------------

// Date.now() inside 'use workflow' is pinned to the run's fixed replay
// timestamp, so a per-iteration turn id has to come from a step's real clock.
async function generateTurnId(automationId: string): Promise<string> {
  'use step'
  return `automation-${automationId}-${Date.now()}`
}

async function executeAutomationRun(input: AutomationScheduleWorkflowInput): Promise<void> {
  const now = Date.now()
  await runAutomationAgentTurn({
    automationId: input.automationId,
    runId: input.runId,
    userId: input.userId,
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    projectId: input.projectId,
    modelId: input.modelId,
    conversationId: input.conversationId,
    turnId: await generateTurnId(input.automationId),
    scheduledFor: now,
    workspaceId: input.workspaceId,
  })
}

/**
 * Build a deterministic approval token for an automation.
 * The token is used by createHook() to suspend the workflow and by
 * resumeHook() to resume it from an external API route.
 */
export function buildApprovalToken(automationId: string, runTimestamp: number): string {
  return `automation-approval:${automationId}:${runTimestamp}`
}
