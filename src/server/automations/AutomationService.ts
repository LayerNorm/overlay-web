import 'server-only'

import { logger } from '@/server/observability/logger'
import type {
  AutomationForUpdateNote,
  AutomationRepository,
  AutomationSchedule,
} from './AutomationRepository'
import type { AutomationSummary } from '@overlay/app-core'
import {
  AutomationEntitlementError,
  type AutomationEntitlementPolicy,
} from './AutomationEntitlementPolicy'
import type { AutomationRunWorkflowInput } from '@/server/workflows/automation-run'
import { automationApprovalToken, automationRunTurnId } from '@/shared/automations/run-identity'
import { requireWorkspaceExecution, WorkspaceExecutionError } from '@/server/billing/WorkspaceExecutionPolicy'

const MIN_INTERVAL_MINUTES = 15
const MANUAL_APPROVAL_TIMEOUT_MS = 24 * 60 * 60_000

/**
 * Runs only target the automation-owned thread. The source conversation is
 * provenance, never an execution target; older rows can carry it as
 * conversationId, and then the run workflow creates the owned thread.
 */
function ownedConversationId(automation: { conversationId?: string; sourceConversationId?: string }): string | undefined {
  return automation.conversationId && automation.conversationId !== automation.sourceConversationId
    ? automation.conversationId
    : undefined
}

export class AutomationServiceError extends Error {
  constructor(
    readonly payload: Record<string, unknown>,
    readonly statusCode: number,
    message?: string,
  ) {
    super(message ?? String(payload.error ?? 'Automation service error'))
    this.name = 'AutomationServiceError'
  }
}

type AutomationServiceClock = {
  now(): number
}

export type AutomationServiceDeps = {
  automationWorkflowStarter?: (
    input: AutomationRunWorkflowInput,
  ) => Promise<{ runId: string }>
  clock?: AutomationServiceClock
  entitlementPolicy: AutomationEntitlementPolicy
  repository: AutomationRepository
  requireExecution?: typeof requireWorkspaceExecution
}

type CreateAutomationBody = {
  accessToken?: string
  userId?: string
  name?: string
  description?: string
  instructions?: string
  enabled?: boolean
  schedule?: AutomationSchedule
  timezone?: string
  modelId?: string
  graphSource?: string
  graph?: AutomationSummary['graph']
  sourceConversationId?: string
  concurrencyPolicy?: 'skip' | 'queue'
  scope?: 'personal' | 'workspace'
  byAgent?: boolean
}

type UpdateAutomationBody = {
  accessToken?: string
  userId?: string
  automationId?: string
  action?: 'cancel-run' | 'pause' | 'resume' | 'retry-run'
  runId?: string
  name?: string
  description?: string
  instructions?: string
  enabled?: boolean
  schedule?: AutomationSchedule
  timezone?: string
  modelId?: string
  graphSource?: string
  graph?: AutomationSummary['graph']
  sourceConversationId?: string
  concurrencyPolicy?: 'skip' | 'queue'
  expectedUpdatedAt?: number
}

const AUTOMATION_CONFLICT_MESSAGE = 'This automation changed elsewhere. Reload it before saving your edits.'

function serviceError(payload: Record<string, unknown>, statusCode: number): never {
  throw new AutomationServiceError(payload, statusCode)
}


function scheduleTooFrequent(schedule: AutomationSchedule | undefined): boolean {
  return schedule?.kind === 'interval' && (schedule.intervalMinutes ?? 60) < MIN_INTERVAL_MINUTES
}

/**
 * Defensive: LLMs or other API clients may pass the schedule as a stringified
 * JSON string instead of a JSON object. Parse it back to an object if needed.
 */
function normalizeScheduleValue(schedule: unknown): AutomationSchedule {
  if (typeof schedule === 'string') {
    try {
      return JSON.parse(schedule) as AutomationSchedule
    } catch (_error) {
      throw new Error('Invalid schedule: expected an object, received a string that is not valid JSON')
    }
  }
  return schedule as AutomationSchedule
}

function stableScheduleKey(schedule: AutomationSchedule | undefined): string {
  if (!schedule) return ''
  if (schedule.kind === 'interval') return `interval:${schedule.intervalMinutes ?? ''}`
  if (schedule.kind === 'daily') return `daily:${schedule.hourUTC ?? ''}:${schedule.minuteUTC ?? ''}`
  if (schedule.kind === 'weekly') return `weekly:${schedule.dayOfWeekUTC ?? ''}:${schedule.hourUTC ?? ''}:${schedule.minuteUTC ?? ''}`
  return `monthly:${schedule.dayOfMonthUTC ?? ''}:${schedule.hourUTC ?? ''}:${schedule.minuteUTC ?? ''}`
}

const UTC_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  hour: 'numeric',
  minute: '2-digit',
})
const UTC_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'long',
})

function formatLocalTime(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  } catch (_error) {
    return UTC_TIME_FORMATTER.format(date)
  }
}

function weekdayName(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    }).format(date)
  } catch (_error) {
    return UTC_WEEKDAY_FORMATTER.format(date)
  }
}

function dateForUtcSchedule(hourUTC = 9, minuteUTC = 0, dayOffset = 0): Date {
  const now = new Date()
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + dayOffset,
    hourUTC,
    minuteUTC,
  ))
}

function formatSchedule(schedule: AutomationSchedule | undefined, timezone: string | undefined): string {
  if (!schedule) return 'unscheduled'
  const zone = timezone?.trim() || 'UTC'
  if (schedule.kind === 'interval') {
    const minutes = schedule.intervalMinutes ?? 60
    if (minutes % 1440 === 0) return `every ${minutes / 1440} day${minutes === 1440 ? '' : 's'}`
    if (minutes % 60 === 0) return `every ${minutes / 60} hour${minutes === 60 ? '' : 's'}`
    return `every ${minutes} minutes`
  }
  if (schedule.kind === 'daily') {
    return `daily at ${formatLocalTime(dateForUtcSchedule(schedule.hourUTC, schedule.minuteUTC), zone)} ${zone}`
  }
  if (schedule.kind === 'weekly') {
    const today = new Date().getUTCDay()
    const target = schedule.dayOfWeekUTC ?? 1
    const dayOffset = (target - today + 7) % 7
    const date = dateForUtcSchedule(schedule.hourUTC, schedule.minuteUTC, dayOffset)
    return `weekly on ${weekdayName(date, zone)} at ${formatLocalTime(date, zone)} ${zone}`
  }
  const day = schedule.dayOfMonthUTC ?? 1
  return `monthly on day ${day} at ${formatLocalTime(dateForUtcSchedule(schedule.hourUTC, schedule.minuteUTC), zone)} ${zone}`
}

export function buildAutomationUpdateNote(
  before: AutomationForUpdateNote,
  after: {
    name?: string
    description?: string
    instructions?: string
    enabled?: boolean
    schedule?: AutomationSchedule
    timezone?: string
    modelId?: string
  },
): string | null {
  const changes: string[] = []
  const beforeName = (before.name || before.title || 'Untitled automation').trim()
  const afterName = after.name !== undefined ? after.name.trim() : beforeName
  if (after.name !== undefined && afterName !== beforeName) changes.push(`name changed to "${afterName || beforeName}"`)

  if (after.description !== undefined && after.description.trim() !== (before.description || '').trim()) {
    changes.push('description updated')
  }
  if (after.instructions !== undefined && after.instructions.trim() !== (before.instructions || '').trim()) {
    changes.push('instructions updated')
  }
  const nextTimezone = after.timezone !== undefined ? after.timezone.trim() || 'UTC' : before.timezone
  if (after.schedule !== undefined && stableScheduleKey(after.schedule) !== stableScheduleKey(before.schedule)) {
    changes.push(`schedule changed to ${formatSchedule(after.schedule, nextTimezone)}`)
  } else if (after.timezone !== undefined && nextTimezone !== (before.timezone || 'UTC')) {
    changes.push(`timezone changed to ${nextTimezone}`)
  }
  if (after.enabled !== undefined && after.enabled !== (before.enabled ?? true)) {
    changes.push(after.enabled ? 'enabled' : 'paused')
  }
  if (after.modelId !== undefined && (after.modelId.trim() || '') !== (before.modelId || '')) {
    changes.push(`model changed to ${after.modelId.trim() || 'default'}`)
  }

  if (changes.length === 0) return null
  return `Automation updated: ${changes.join('; ')}.`
}

export class AutomationService {
  private readonly clock: AutomationServiceClock

  constructor(private readonly deps: AutomationServiceDeps) {
    this.clock = deps.clock ?? { now: () => Date.now() }
  }

  async getAutomations(args: {
    automationId?: string | null
    includeDeleted?: boolean
    includeRuns?: boolean
    userId: string
    view?: 'personal' | 'workspace' | 'archived'
    workspaceId?: string
  }): Promise<unknown> {
    if (args.automationId && args.includeRuns) {
      return await this.deps.repository.listRuns({
        automationId: args.automationId,
        userId: args.userId,
      })
    }
    if (args.automationId) {
      const automation = await this.deps.repository.getAutomation({
        automationId: args.automationId,
        userId: args.userId,
        workspaceId: args.workspaceId,
      })
      if (!automation) serviceError({ error: 'Not found' }, 404)
      return automation
    }
    return await this.deps.repository.listAutomations({
      userId: args.userId,
      includeDeleted: args.includeDeleted,
      workspaceId: args.workspaceId,
      view: args.view,
    })
  }

  async createAutomation(args: {
    body: CreateAutomationBody
    userId: string
    workspaceId?: string
  }): Promise<{ success: true; id: unknown }> {
    const { body } = args
    if (!body.name?.trim() || !body.description?.trim() || !body.instructions?.trim() || !body.schedule) {
      serviceError({ error: 'name, description, instructions, and schedule are required' }, 400)
    }
    const schedule = normalizeScheduleValue(body.schedule)
    this.assertScheduleAllowed(schedule)
    if (body.enabled !== false) {
      await this.assertCanEnable(args.userId)
    }

    const id = await this.deps.repository.createAutomation({
      userId: args.userId,
      name: body.name,
      description: body.description,
      instructions: body.instructions,
      enabled: body.enabled,
      schedule,
      timezone: body.timezone,
      modelId: body.modelId,
      graphSource: body.graphSource,
      graph: body.graph,
      sourceConversationId: body.sourceConversationId,
      concurrencyPolicy: body.concurrencyPolicy,
      workspaceId: args.workspaceId,
      ...(body.scope === 'workspace' || body.scope === 'personal' ? { scope: body.scope } : {}),
      ...(body.byAgent === true ? { byAgent: true } : {}),
    })
    if (!id) throw new Error('Automation create returned no id')
    return { success: true, id }
  }

  async updateAutomation(args: {
    body: UpdateAutomationBody
    userId: string
    workspaceId?: string
  }): Promise<{ success: true }> {
    const { body } = args
    if (body.action === 'cancel-run') {
      if (!body.runId) serviceError({ error: 'runId required' }, 400)
      const cancelled = await this.deps.repository.requestRunCancellation({
        runId: body.runId,
        userId: args.userId,
      })
      if (!cancelled) serviceError({ error: 'Run is not cancellable' }, 409)
      return { success: true }
    }
    if (body.action === 'retry-run') {
      if (!body.runId) serviceError({ error: 'runId required' }, 400)
      const retryRunId = await this.deps.repository.retryRun({
        runId: body.runId,
        userId: args.userId,
      })
      if (!retryRunId) serviceError({ error: 'Run is not retryable' }, 409)
      return { success: true }
    }
    if (!body.automationId) {
      serviceError({ error: 'automationId required' }, 400)
    }
    const schedule = body.schedule ? normalizeScheduleValue(body.schedule) : body.schedule
    this.assertScheduleAllowed(schedule)
    if (body.action === 'resume' || body.enabled === true) {
      await this.assertCanEnable(args.userId)
    }

    const automationId = body.automationId
    const idArgs = { automationId, userId: args.userId, workspaceId: args.workspaceId }
    const existingAutomation = await this.deps.repository.getAutomation(idArgs)
    // A form loaded from an older version must not overwrite a newer one; refuse before any side effect.
    if (typeof body.expectedUpdatedAt === 'number' && existingAutomation && existingAutomation.updatedAt !== body.expectedUpdatedAt) {
      serviceError({ error: AUTOMATION_CONFLICT_MESSAGE, conflict: true }, 409)
    }
    if (body.action === 'pause') {
      await this.deps.repository.pauseAutomation(idArgs)
    } else if (body.action === 'resume') {
      await this.deps.repository.resumeAutomation(idArgs)
    } else {
      const before = existingAutomation
      try {
        await this.deps.repository.updateAutomation({
          ...idArgs,
          ...(typeof body.expectedUpdatedAt === 'number' ? { expectedUpdatedAt: body.expectedUpdatedAt } : {}),
          name: body.name,
          description: body.description,
          instructions: body.instructions,
          enabled: body.enabled,
          schedule,
          timezone: body.timezone,
          modelId: body.modelId,
          graphSource: body.graphSource,
          graph: body.graph,
          sourceConversationId: body.sourceConversationId,
          concurrencyPolicy: body.concurrencyPolicy,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('AUTOMATION_CONFLICT')) {
          serviceError({ error: AUTOMATION_CONFLICT_MESSAGE, conflict: true }, 409)
        }
        throw error
      }
      if (before) {
        await this.appendUpdateNoteBestEffort(before, {
          name: body.name,
          description: body.description,
          instructions: body.instructions,
          enabled: body.enabled,
          schedule,
          timezone: body.timezone,
          modelId: body.modelId,
        }, args.userId)
      }
    }
    return { success: true }
  }

  async deleteAutomation(args: {
    automationId?: string | null
    userId: string
    workspaceId?: string
  }): Promise<{ success: true; linkedConversationIds: string[] }> {
    if (!args.automationId) {
      serviceError({ error: 'automationId required' }, 400)
    }
    const automationId = args.automationId
    const automation = await this.deps.repository.getAutomation({
      automationId,
      userId: args.userId,
      workspaceId: args.workspaceId,
    })
    // Only the automation-owned thread is deleted. The sourceConversationId
    // is provenance — the chat the automation was drafted in belongs to the
    // user (or the agent), and deleting the automation must not destroy it.
    // Guard: legacy rows can have conversationId === sourceConversationId
    // (the shared thread was stamped as the run target); never delete those.
    const ownedConversationId =
      automation?.conversationId && automation.conversationId !== automation.sourceConversationId
        ? automation.conversationId
        : undefined
    const linkedConversationIds = [ownedConversationId]
      .filter((id, index, ids): id is string => Boolean(id && ids.indexOf(id) === index))

    // Cancel any active individual runs (queued or running)
    if (this.deps.repository.requestActiveRunCancellation) {
      await this.deps.repository.requestActiveRunCancellation({
        automationId,
      }).catch((error) => {
        logger.warn('[automations DELETE] Failed to cancel active runs', error)
      })
    }

    await this.deps.repository.removeAutomation({
      automationId,
      userId: args.userId,
      workspaceId: args.workspaceId,
    })

    await Promise.all(linkedConversationIds.map((conversationId) =>
      this.deps.repository.removeConversation({
        conversationId,
        userId: args.userId,
      }).catch((error) => {
        logger.warn('[automations DELETE] Failed to delete linked conversation', error)
      })))

    return { success: true, linkedConversationIds }
  }

  /**
   * Start a manual ("Run now" / "Test") run: create the run row, then start
   * the same durable run workflow scheduled runs use. The workflow settles
   * the row; callers follow it by its run ID.
   */
  async startManualRun(args: {
    automationId?: string | null
    userId: string
    workspaceId: string
  }): Promise<{ ok: true; durable: true; runId: string; workflowRunId: string; approvalToken?: string; approvalRequired?: true }> {
    if (!args.automationId) serviceError({ error: 'automationId required' }, 400)
    const automation = await this.deps.repository.getAutomation({
      automationId: args.automationId,
      userId: args.userId,
    })
    if (!automation || automation.deletedAt) serviceError({ error: 'Automation not found' }, 404)
    const instructions = (automation.instructions || automation.instructionsMarkdown || '').trim()
    if (!instructions) serviceError({ error: 'Automation has no instructions to run' }, 400)
    if (!this.deps.automationWorkflowStarter) {
      serviceError({ error: 'Durable automation dispatch is not configured' }, 503)
    }

    const scheduledFor = this.clock.now()
    const runId = await this.deps.repository.createManualRun({
      automationId: automation._id,
      userId: args.userId,
      scheduledFor,
    })
    if (!runId) serviceError({ error: 'Failed to create automation run' }, 500)

    // Condition nodes in the automation graph make a run wait for approval.
    const graph = (automation as { graph?: { nodes?: Array<{ kind: string }> } }).graph
    const approvalToken = graph?.nodes?.some(node => node.kind === 'condition')
      ? automationApprovalToken(automation._id, scheduledFor)
      : undefined

    const workflowRunId = await this.startRunWorkflow({
      automationId: automation._id,
      runId,
      userId: args.userId,
      name: automation.name || automation.title || 'Untitled automation',
      description: automation.description || '',
      instructions,
      modelId: automation.modelId,
      conversationId: ownedConversationId(automation),
      workspaceId: args.workspaceId,
      scheduledFor,
      ...(approvalToken ? { approvalToken, approvalTimeoutMs: MANUAL_APPROVAL_TIMEOUT_MS } : {}),
    })
    return {
      ok: true,
      durable: true,
      runId,
      workflowRunId,
      ...(approvalToken ? { approvalToken, approvalRequired: true as const } : {}),
    }
  }

  /** Start the run workflow and record its owner; a start failure fails the run. */
  private async startRunWorkflow(input: AutomationRunWorkflowInput): Promise<string> {
    let workflowRun: { runId: string }
    try {
      workflowRun = await this.deps.automationWorkflowStarter!(input)
    } catch (error) {
      await this.markRunFailed({
        runId: input.runId,
        userId: input.userId,
        error: error instanceof Error ? error.message : 'Failed to start automation workflow',
      }).catch((_error) => null)
      throw error
    }
    await this.updateRunWorkflowRunId({ runId: input.runId, workflowRunId: workflowRun.runId })
    return workflowRun.runId
  }

  // -------------------------------------------------------------------------
  // Durable execution helpers — used by the POST /api/v1/automations/{id}/run
  // route to start a workflow-based automation run.
  // -------------------------------------------------------------------------

  /**
   * Dispatch a scheduler-claimed run through the durable one-shot automation
   * workflow. The Convex runner marks the run 'running' before POSTing, so the
   * run must be in that state and belong to the service-auth user. The
   * workflow's own steps settle run status — callers must not mark completion
   * on dispatch.
   */
  async startDurableScheduledRun(args: {
    runId?: string
    serviceUserId: string
    baseUrl: string
  }): Promise<{ ok: true; durable: true; runId: string; workflowRunId: string }> {
    if (!args.runId) serviceError({ error: 'runId required' }, 400)
    const payload = await this.deps.repository.getRunForExecution({ runId: args.runId })
    if (!payload || payload.run.status !== 'running') {
      serviceError({ error: 'Automation run is not executable' }, 409)
    }
    const { run, automation } = payload
    if (automation.userId !== args.serviceUserId) {
      serviceError({ error: 'Unauthorized' }, 401)
    }

    // Idempotent replay: Convex scheduled actions are at-least-once, so a
    // duplicate dispatch must return the existing workflow instead of
    // starting a second execution for the same run.
    if (run.workflowRunId) {
      return { ok: true, durable: true, runId: run._id, workflowRunId: run.workflowRunId }
    }

    if (!automation.workspaceId) {
      const message = 'Automation is missing its workspace billing scope.'
      await this.markRunFailed({ runId: run._id, userId: automation.userId, error: message })
      serviceError({
        error: 'workspace_execution_required',
        code: 'workspace_execution_required',
        message,
        recovery: 'contact_owner',
      }, 402)
    }
    try {
      await (this.deps.requireExecution ?? requireWorkspaceExecution)({
        userId: automation.userId,
        workspaceId: automation.workspaceId,
      })
    } catch (error) {
      if (error instanceof WorkspaceExecutionError) {
        await this.markRunFailed({ runId: run._id, userId: automation.userId, error: error.message })
        throw new AutomationServiceError(error.payload, error.statusCode)
      }
      throw error
    }

    if (!this.deps.automationWorkflowStarter) {
      serviceError({ error: 'Durable automation dispatch is not configured' }, 503)
    }
    const workflowRunId = await this.startRunWorkflow({
      automationId: automation._id,
      runId: run._id,
      userId: automation.userId,
      name: automation.name || automation.title || 'Untitled automation',
      description: automation.description || '',
      instructions: automation.instructions || automation.instructionsMarkdown || '',
      modelId: automation.modelId,
      conversationId: ownedConversationId(automation),
      workspaceId: automation.workspaceId,
      scheduledFor: run.scheduledFor,
    })

    return { ok: true, durable: true, runId: run._id, workflowRunId }
  }

  async getAutomationForExecution(args: {
    automationId: string
    userId: string
  }) {
    return await this.deps.repository.getAutomation({
      automationId: args.automationId,
      userId: args.userId,
    })
  }

  async attachOwnedConversation(args: {
    automationId: string
    conversationId: string
    userId: string
  }): Promise<void> {
    await this.deps.repository.attachOwnedConversation(args)
  }

  async updateRunWorkflowRunId(args: {
    runId: string
    workflowRunId: string
  }): Promise<void> {
    await this.deps.repository.updateRunWorkflowRunId?.(args)
  }

  async markRunStarted(args: {
    runId: string
    userId: string
    conversationId?: string
    expectedWorkflowRunId?: string
  }): Promise<void> {
    await this.deps.repository.markManualRunStarted({
      runId: args.runId,
      userId: args.userId,
      conversationId: args.conversationId,
      turnId: automationRunTurnId(args.runId),
      ...(args.expectedWorkflowRunId ? { expectedWorkflowRunId: args.expectedWorkflowRunId } : {}),
      now: this.clock.now(),
    })
  }

  async markRunCompleted(args: {
    runId: string
    userId: string
    conversationId?: string
    expectedWorkflowRunId?: string
    expectedTurnId?: string
  }): Promise<void> {
    await this.deps.repository.markManualRunCompleted({
      runId: args.runId,
      userId: args.userId,
      // Pass undefined (not '') so Convex's v.optional(v.id()) validator
      // accepts it. An empty string is not a valid Convex ID and will throw.
      conversationId: args.conversationId || undefined,
      ...(args.expectedWorkflowRunId ? { expectedWorkflowRunId: args.expectedWorkflowRunId } : {}),
      ...(args.expectedTurnId ? { expectedTurnId: args.expectedTurnId } : {}),
      now: this.clock.now(),
    })
  }

  async markRunFailed(args: {
    runId: string
    userId: string
    error: string
    expectedWorkflowRunId?: string
    expectedTurnId?: string
    status?: 'failed' | 'cancelled' | 'skipped'
  }): Promise<void> {
    await this.deps.repository.markManualRunFailed({
      runId: args.runId,
      userId: args.userId,
      error: args.error,
      ...(args.expectedWorkflowRunId ? { expectedWorkflowRunId: args.expectedWorkflowRunId } : {}),
      ...(args.expectedTurnId ? { expectedTurnId: args.expectedTurnId } : {}),
      ...(args.status ? { status: args.status } : {}),
      now: this.clock.now(),
    })
  }

  async settleRun(args: {
    conversationId?: string
    error?: string
    expectedWorkflowRunId: string
    expectedStatus: 'queued' | 'running' | 'completed' | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled' | 'skipped' | 'dead_letter'
    expectedTurnId?: string
    runId: string
    status: 'completed' | 'failed' | 'cancelled' | 'skipped'
    userId: string
  }): Promise<boolean> {
    if (!this.deps.repository.settleManualRun) throw new Error('Owner-fenced automation settlement is unavailable.')
    return await this.deps.repository.settleManualRun(args)
  }

  private assertScheduleAllowed(schedule: AutomationSchedule | undefined): void {
    if (scheduleTooFrequent(schedule)) {
      serviceError({ error: `Interval automations must run at least ${MIN_INTERVAL_MINUTES} minutes apart.` }, 400)
    }
  }

  private async assertCanEnable(userId: string): Promise<void> {
    const existing = await this.deps.repository.listAutomations({ userId })
    const enabledCount = existing.filter((item) => item.enabled !== false).length
    try {
      await this.deps.entitlementPolicy.assertCanEnable({ enabledCount, userId })
    } catch (error) {
      if (error instanceof AutomationEntitlementError) {
        serviceError({ error: error.publicMessage }, 403)
      }
      throw error
    }
  }

  private async appendUpdateNoteBestEffort(
    automation: AutomationForUpdateNote,
    after: Parameters<typeof buildAutomationUpdateNote>[1],
    userId: string,
  ): Promise<void> {
    const updateNote = buildAutomationUpdateNote(automation, after)
    const conversationId = automation.conversationId
    if (!updateNote || !conversationId) return
    await this.deps.repository.appendAutomationUpdateNote({
      automationId: automation._id,
      userId,
      conversationId,
      content: updateNote,
    }).catch((error) => {
      logger.warn('[automations PATCH] Failed to append automation update note', error)
    })
  }
}

