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
 * Trigger: POST /api/v1/automations/{id}/run (when durableAutomations is enabled)
 * Cancel:  workflow run is stopped when automation is disabled or deleted
 * Inspect: npx workflow web
 */

import { sleep, RetryableError, FatalError, createHook } from "workflow"
import type { AutomationSchedule } from "../src/shared/automations/schedule"
import { computeNextRunAt, msUntilNextRun } from "../src/shared/automations/schedule"

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
  serviceAuthHeader: string
  serviceToken: string
  actServiceToken: string
  finalizeServiceToken: string
  workspaceId?: string
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
  let runCount = 0
  for (;;) {
    // Compute sleep duration until next scheduled run
    const now = Date.now()
    const sleepMs = msUntilNextRun(input.schedule, now)

    await sleep(sleepMs)

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
    runCount += 1
  }
}

// ---------------------------------------------------------------------------
// Approval step — suspends workflow until external webhook resumes the hook
// ---------------------------------------------------------------------------

async function waitForApproval(input: AutomationScheduleWorkflowInput): Promise<boolean> {
  "use step"

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
    } catch {
      hook.dispose()
      return false
    }
  }

  // No timeout — wait indefinitely for approval
  const result = await hook
  return result.approved !== false
}

// ---------------------------------------------------------------------------
// Execution step — calls the automation run endpoint to execute the turn
// ---------------------------------------------------------------------------

async function executeAutomationRun(input: AutomationScheduleWorkflowInput): Promise<{ ok: true }> {
  "use step"

  const runPath = '/api/v1/automations/execute'
  const turnId = `automation-${input.automationId}-${Date.now()}`

  const response = await fetch(`${input.baseUrl}/api/v1/conversations/act`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': `automation:${input.automationId}:${turnId}`,
      [input.serviceAuthHeader]: input.actServiceToken,
      ...(input.workspaceId ? { 'x-overlay-workspace-id': input.workspaceId } : {}),
    },
    body: JSON.stringify({
      messages: [{
        id: turnId,
        role: 'user',
        parts: [{ type: 'text', text: buildAutomationUserMessage(input) }],
      }],
      systemPrompt: buildAutomationSystemPrompt(input),
      conversationId: input.conversationId,
      turnId,
      modelId: input.modelId,
      userId: input.userId,
      automationExecution: true,
      actAbortTimeoutMs: 720_000,
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    if (response.status >= 400 && response.status < 500) {
      throw new FatalError(
        `Act route returned ${response.status}: ${text || 'Client error'}`,
      )
    }
    throw new RetryableError(
      `Act route returned ${response.status}: ${text || 'Server error'}`,
    )
  }

  // Drain the response body so the act route can finish and persist
  if (response.body) {
    const reader = response.body.getReader()
    try {
      while (!(await reader.read()).done) {
        // Consume the UI stream
      }
    } finally {
      reader.releaseLock()
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Helpers — build user message and system prompt for the automation run
// ---------------------------------------------------------------------------

export function buildAutomationUserMessage(input: AutomationScheduleWorkflowInput): string {
  const scheduledAt = new Date().toISOString()
  return [
    `Execute saved automation now: ${input.name}`,
    input.description ? `Description: ${input.description}` : '',
    `Scheduled for: ${scheduledAt}`,
    `Automation ID: ${input.automationId}`,
    '',
    'Current saved instructions to execute:',
    input.instructions,
  ].filter(Boolean).join('\n')
}

export function buildAutomationSystemPrompt(input: AutomationScheduleWorkflowInput): string {
  return [
    'You are running a scheduled automation for the user.',
    'Execute the stored automation instructions without asking clarifying questions.',
    'Do not create, draft, update, pause, delete, or propose a new automation. This run is already attached to an existing saved automation.',
    'If required auth, context, or tool access is missing, stop and write a concise failure summary.',
    'Only use tools that are clearly authorized by the stored automation and connected for this user.',
    'End with a concise summary of what was completed and what still needs attention.',
    '',
    `Automation name: ${input.name}`,
    input.description ? `Automation description: ${input.description}` : '',
  ].filter(Boolean).join('\n')
}

/**
 * Build a deterministic approval token for an automation.
 * The token is used by createHook() to suspend the workflow and by
 * resumeHook() to resume it from an external API route.
 */
export function buildApprovalToken(automationId: string, runTimestamp: number): string {
  return `automation-approval:${automationId}:${runTimestamp}`
}
