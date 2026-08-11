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
import { msUntilNextRun } from "../src/shared/automations/schedule"
import { freshAutomationServiceAuth } from './automation-service-auth'

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
    const status = await checkAutomationStatus(input)
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

  const executePath = '/api/v1/automations/execute'
  const turnId = `automation-${input.automationId}-${Date.now()}`

  // Mark the run as started in the automation_runs table
  if (input.runId) {
    try {
      const auth = await freshAutomationServiceAuth(input.userId, 'POST', executePath)
      await fetch(`${input.baseUrl}${executePath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [auth.header]: auth.token,
        },
        body: JSON.stringify({
          action: 'mark-started',
          runId: input.runId,
          userId: input.userId,
          turnId,
          ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        }),
      })
    } catch {
      // Non-fatal — the run will still execute, just with a stale status
    }
  }

  let response: Response
  try {
    const auth = await freshAutomationServiceAuth(
      input.userId,
      'POST',
      '/api/v1/conversations/act',
    )
    response = await fetch(`${input.baseUrl}/api/v1/conversations/act`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': `automation:${input.automationId}:${turnId}`,
        [auth.header]: auth.token,
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
        automationId: input.automationId,
        actAbortTimeoutMs: 720_000,
      }),
    })
  } catch (actError) {
    // Mark the run as failed if the act call itself threw
    if (input.runId) {
      await markRunFinalized(input, 'failed', actError instanceof Error ? actError.message : 'Act request failed')
    }
    throw actError
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    if (input.runId) {
      await markRunFinalized(input, 'failed', `Act route returned ${response.status}: ${text || 'error'}`)
    }
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

  // Mark the run as succeeded
  if (input.runId) {
    await markRunFinalized(input, 'succeeded')
  }

  return { ok: true }
}

/**
 * Mark the automation run as succeeded or failed via the execute endpoint.
 * Mints a fresh PATCH credential immediately before the request.
 */
async function markRunFinalized(
  input: AutomationScheduleWorkflowInput,
  runStatus: 'succeeded' | 'failed',
  errorMessage?: string,
): Promise<void> {
  const executePath = '/api/v1/automations/execute'
  try {
    const auth = await freshAutomationServiceAuth(input.userId, 'PATCH', executePath)
    await fetch(`${input.baseUrl}${executePath}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        [auth.header]: auth.token,
      },
      body: JSON.stringify({
        runId: input.runId,
        runStatus,
        userId: input.userId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(errorMessage ? { error: errorMessage } : {}),
      }),
    })
  } catch {
    // Non-fatal — the run already completed, status sync is best-effort
  }
}

/**
 * Safety net: check if the automation is still enabled and not deleted.
 * Called before each iteration of the scheduling loop. If the automation
 * is disabled or deleted, the workflow exits gracefully.
 */
async function checkAutomationStatus(
  input: AutomationScheduleWorkflowInput,
): Promise<{ enabled: boolean; deleted: boolean }> {
  "use step"

  const executePath = '/api/v1/automations/execute'
  try {
    const auth = await freshAutomationServiceAuth(input.userId, 'POST', executePath)
    const response = await fetch(`${input.baseUrl}${executePath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [auth.header]: auth.token,
      },
      body: JSON.stringify({
        action: 'check-status',
        automationId: input.automationId,
        userId: input.userId,
      }),
    })
    if (!response.ok) {
      // If the check fails, assume the automation is still active (fail open)
      return { enabled: true, deleted: false }
    }
    const data = await response.json() as { enabled?: boolean; deleted?: boolean }
    return {
      enabled: data.enabled !== false,
      deleted: data.deleted === true,
    }
  } catch {
    // Network errors — fail open, let the workflow continue
    return { enabled: true, deleted: false }
  }
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
