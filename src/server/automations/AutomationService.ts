import 'server-only'

import { logger } from '@/server/observability/logger'
import type { LifecycleEventPublisher } from '@/server/lifecycle-events'
import { withObservabilityContext } from '@/server/observability/context'
import { runActTurnForScheduledAutomation, type ScheduledAutomationTurn } from '@/server/agent/run-act-turn'
import { emitAutomationFailed, emitAutomationFinished } from '@/server/shared/webhooks'
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

const MIN_INTERVAL_MINUTES = 15

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

type AutomationServiceEvents = {
  finished(params: {
    automationId: string
    conversationId: string
    runId: string
    userId: string
  }): void
  failed(params: {
    automationId: string
    error: string
    runId: string
    userId: string
  }): void
}

export type AutomationExecutor = (input: ScheduledAutomationTurn) => Promise<{
  conversationId: string
}>

export type AutomationServiceDeps = {
  assertProjectAutomationAllowed?: (args: {
    projectId: string
    userId: string
  }) => Promise<boolean>
  clock?: AutomationServiceClock
  events?: AutomationServiceEvents
  entitlementPolicy: AutomationEntitlementPolicy
  executor?: AutomationExecutor
  lifecycleEvents?: () => LifecycleEventPublisher
  repository: AutomationRepository
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
  projectId?: string
  modelId?: string
  graphSource?: string
  graph?: AutomationSummary['graph']
  sourceConversationId?: string
  concurrencyPolicy?: 'skip' | 'queue'
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
  projectId?: string
  modelId?: string
  graphSource?: string
  graph?: AutomationSummary['graph']
  sourceConversationId?: string
  concurrencyPolicy?: 'skip' | 'queue'
}

function serviceError(payload: Record<string, unknown>, statusCode: number): never {
  throw new AutomationServiceError(payload, statusCode)
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch (_error) {
    return 'Unknown automation error'
  }
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
    } catch {
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

function formatLocalTime(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  } catch (_error) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
}

function weekdayName(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    }).format(date)
  } catch (_error) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
    }).format(date)
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

const defaultEvents: AutomationServiceEvents = {
  finished: emitAutomationFinished,
  failed: emitAutomationFailed,
}

export class AutomationService {
  private readonly clock: AutomationServiceClock
  private readonly events: AutomationServiceEvents
  private readonly executor: AutomationExecutor

  constructor(private readonly deps: AutomationServiceDeps) {
    this.clock = deps.clock ?? { now: () => Date.now() }
    this.events = deps.events ?? defaultEvents
    this.executor = deps.executor ?? runActTurnForScheduledAutomation
  }

  async getAutomations(args: {
    automationId?: string | null
    includeDeleted?: boolean
    includeRuns?: boolean
    projectId?: string
    userId: string
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
      })
      if (!automation) serviceError({ error: 'Not found' }, 404)
      return automation
    }
    return await this.deps.repository.listAutomations({
      userId: args.userId,
      includeDeleted: args.includeDeleted,
      projectId: args.projectId,
    })
  }

  async createAutomation(args: {
    body: CreateAutomationBody
    userId: string
  }): Promise<{ success: true; id: unknown }> {
    const { body } = args
    if (!body.name?.trim() || !body.description?.trim() || !body.instructions?.trim() || !body.schedule) {
      serviceError({ error: 'name, description, instructions, and schedule are required' }, 400)
    }
    const schedule = normalizeScheduleValue(body.schedule)
    this.assertScheduleAllowed(schedule)
    await this.assertProjectAllowsAutomation(body.projectId, args.userId)
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
      projectId: body.projectId,
      modelId: body.modelId,
      graphSource: body.graphSource,
      graph: body.graph,
      sourceConversationId: body.sourceConversationId,
      concurrencyPolicy: body.concurrencyPolicy,
    })
    if (!id) throw new Error('Automation create returned no id')
    return { success: true, id }
  }

  async updateAutomation(args: {
    body: UpdateAutomationBody
    userId: string
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
    const idArgs = { automationId, userId: args.userId }
    const existingAutomation = await this.deps.repository.getAutomation(idArgs)
    if (
      body.action === 'resume'
      || body.enabled === true
      || (body.projectId !== undefined && body.enabled !== false)
    ) {
      await this.assertProjectAllowsAutomation(
        body.projectId ?? existingAutomation?.projectId,
        args.userId,
      )
    }
    if (body.action === 'pause') {
      // Cancel any active scheduler workflow before pausing
      await this.cancelSchedulerWorkflow(idArgs)
      await this.deps.repository.pauseAutomation(idArgs)
    } else if (body.action === 'resume') {
      await this.deps.repository.resumeAutomation(idArgs)
    } else {
      const before = existingAutomation
      // If the update disables the automation, cancel its scheduler workflow
      if (body.enabled === false && before?.schedulerWorkflowRunId) {
        await this.cancelSchedulerWorkflow(idArgs)
      }
      await this.deps.repository.updateAutomation({
        ...idArgs,
        name: body.name,
        description: body.description,
        instructions: body.instructions,
        enabled: body.enabled,
        schedule,
        timezone: body.timezone,
        projectId: body.projectId,
        modelId: body.modelId,
        graphSource: body.graphSource,
        graph: body.graph,
        sourceConversationId: body.sourceConversationId,
        concurrencyPolicy: body.concurrencyPolicy,
      })
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
  }): Promise<{ success: true; linkedConversationIds: string[] }> {
    if (!args.automationId) {
      serviceError({ error: 'automationId required' }, 400)
    }
    const automationId = args.automationId
    const automation = await this.deps.repository.getAutomation({
      automationId,
      userId: args.userId,
    })
    const isDraftPlaceholder =
      automation?.enabled === false &&
      automation?.name === 'New automation' &&
      automation?.description === 'Draft automation. Add a description before enabling it.' &&
      automation?.instructions === 'Describe what this automation should do.'
    const linkedConversationIds = [
      automation?.conversationId,
      isDraftPlaceholder ? automation?.sourceConversationId : undefined,
    ].filter((id, index, ids): id is string => Boolean(id && ids.indexOf(id) === index))

    // Cancel any active scheduler workflow before deleting the automation
    if (automation?.schedulerWorkflowRunId) {
      await this.cancelSchedulerWorkflow({
        automationId,
        userId: args.userId,
      })
    }

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
    })

    for (const conversationId of linkedConversationIds) {
      await this.deps.repository.removeConversation({
        conversationId,
        userId: args.userId,
      }).catch((error) => {
        logger.warn('[automations DELETE] Failed to delete linked conversation', error)
      })
    }

    return { success: true, linkedConversationIds }
  }

  async testAutomation(args: {
    automationId?: string
    userId: string
    baseUrl?: string
  }): Promise<{ success: true; runId: string; conversationId: string }> {
    let runId: string | null = null
    let automationId: string | null = null
    try {
      if (!args.automationId) {
        serviceError({ error: 'automationId required' }, 400)
      }
      automationId = args.automationId
      const automation = await this.deps.repository.getAutomationRunTarget({
        automationId,
        userId: args.userId,
      })
      if (!automation) serviceError({ error: 'Automation not found' }, 404)
      await this.assertProjectAllowsAutomation(automation.projectId, args.userId)

      const name = (automation.name || automation.title || 'Untitled automation').trim()
      const instructions = (automation.instructions || automation.instructionsMarkdown || '').trim()
      if (!instructions) {
        serviceError({ error: 'Automation has no instructions to test' }, 400)
      }

      const scheduledFor = this.clock.now()
      const turnId = `automation-test-${automationId}-${scheduledFor}`
      const conversationId = automation.sourceConversationId || automation.conversationId

      runId = await this.deps.repository.createManualRun({
        automationId,
        userId: args.userId,
        scheduledFor,
      })
      if (!runId) {
        throw new Error('Automation manual run create returned no id')
      }
      const executionRunId = runId
      const executionAutomationId = automationId

      await this.deps.repository.markManualRunStarted({
        runId: executionRunId,
        userId: args.userId,
        conversationId,
        turnId,
        now: this.clock.now(),
      })

      const result = await withObservabilityContext({
        provider: 'automation',
        runId: executionRunId,
      }, async () => await this.executor({
        automationId: executionAutomationId,
        runId: executionRunId,
        userId: args.userId,
        name,
        description: automation.description || '',
        instructions,
        projectId: automation.projectId,
        modelId: automation.modelId,
        conversationId,
        turnId,
        scheduledFor,
        baseUrl: args.baseUrl,
      }))

      await this.deps.repository.markManualRunCompleted({
        runId,
        userId: args.userId,
        conversationId: result.conversationId,
        now: this.clock.now(),
      })

      this.events.finished({
        userId: args.userId,
        automationId,
        runId,
        conversationId: result.conversationId,
      })
      await this.publishAutomationLifecycleEvent({
        automationId,
        execution: 'manual',
        name: 'automation.succeeded',
        runId,
        userId: args.userId,
      })

      return { success: true, runId, conversationId: result.conversationId }
    } catch (error) {
      await this.failManualRunBestEffort({
        error,
        runId,
        userId: args.userId,
        automationId,
      })
      throw error
    }
  }

  async runAutomation(args: {
    runId?: string
    serviceUserId: string
    baseUrl?: string
  }): Promise<{ success: true; conversationId: string }> {
    let automationId: string | undefined
    let userId: string | undefined
    try {
      if (!args.runId) serviceError({ error: 'runId required' }, 400)
      const executionRunId = args.runId
      const payload = await this.deps.repository.getRunForExecution({ runId: args.runId })
      if (!payload || payload.run.status !== 'running') {
        serviceError({ error: 'Automation run is not executable' }, 409)
      }
      const { run, automation } = payload
      automationId = automation._id
      userId = automation.userId
      if (automation.userId !== args.serviceUserId) {
        serviceError({ error: 'Unauthorized' }, 401)
      }
      await this.assertProjectAllowsAutomation(automation.projectId, automation.userId)
      const turnId = run.turnId || `automation-${args.runId}-${this.clock.now()}`
      const conversationId = run.conversationId || automation.sourceConversationId || automation.conversationId

      const result = await withObservabilityContext({
        provider: 'automation',
        runId: executionRunId,
      }, async () => await this.executor({
        automationId: automation._id,
        runId: executionRunId,
        userId: automation.userId,
        name: automation.name || automation.title || 'Untitled automation',
        description: automation.description || '',
        instructions: automation.instructions || automation.instructionsMarkdown || '',
        projectId: automation.projectId,
        modelId: automation.modelId,
        conversationId,
        turnId,
        scheduledFor: run.scheduledFor,
        baseUrl: args.baseUrl,
      }))

      this.events.finished({
        userId: automation.userId,
        automationId: automation._id,
        runId: args.runId,
        conversationId: result.conversationId,
      })
      await this.publishAutomationLifecycleEvent({
        automationId: automation._id,
        execution: 'scheduled',
        name: 'automation.succeeded',
        runId: args.runId,
        userId: automation.userId,
      })

      return { success: true, conversationId: result.conversationId }
    } catch (error) {
      if (args.runId && automationId && userId) {
        this.events.failed({
          userId,
          automationId,
          runId: args.runId,
          error: summarizeError(error).slice(0, 1000),
        })
        await this.publishAutomationLifecycleEvent({
          automationId,
          execution: 'scheduled',
          failureClass: classifyAutomationFailure(error),
          name: 'automation.failed',
          runId: args.runId,
          userId,
        })
      }
      throw error
    }
  }

  // -------------------------------------------------------------------------
  // Durable execution helpers — used by the POST /api/v1/automations/{id}/run
  // route to start a workflow-based automation run.
  // -------------------------------------------------------------------------

  async createManualRunForDurableExecution(args: {
    automationId: string
    userId: string
  }): Promise<string | null> {
    return await this.deps.repository.createManualRun({
      automationId: args.automationId,
      userId: args.userId,
      scheduledFor: this.clock.now(),
    })
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

  async attachSourceConversation(args: {
    automationId: string
    conversationId: string
    userId: string
  }): Promise<void> {
    await this.deps.repository.attachSourceConversation(args)
  }

  async updateRunWorkflowRunId(args: {
    runId: string
    workflowRunId: string
  }): Promise<void> {
    await this.deps.repository.updateRunWorkflowRunId?.(args)
  }

  async updateSchedulerWorkflowRunId(args: {
    automationId: string
    schedulerWorkflowRunId: string | null
  }): Promise<void> {
    await this.deps.repository.updateSchedulerWorkflowRunId?.(args)
  }

  /**
   * Cancel the long-lived scheduler workflow for an automation.
   * Called when the automation is deleted or paused. Best-effort — if the
   * workflow run ID is missing or the workflow is already gone, this is a no-op.
   */
  async cancelSchedulerWorkflow(args: {
    automationId: string
    userId: string
  }): Promise<void> {
    const automation = await this.deps.repository.getAutomation({
      automationId: args.automationId,
      userId: args.userId,
    })
    const workflowRunId = automation?.schedulerWorkflowRunId
    if (!workflowRunId) return

    try {
      const { getRun } = await import('workflow/api')
      await getRun(workflowRunId).cancel()
    } catch (error) {
      logger.warn('[automations] Failed to cancel scheduler workflow', { automationId: args.automationId, workflowRunId, error })
    }

    // Clear the stored workflow run ID regardless of whether cancellation succeeded
    await this.deps.repository.updateSchedulerWorkflowRunId?.({
      automationId: args.automationId,
      schedulerWorkflowRunId: null,
    }).catch((error) => {
      logger.warn('[automations] Failed to clear schedulerWorkflowRunId', { automationId: args.automationId, error })
    })
  }

  async markRunStarted(args: {
    runId: string
    userId: string
    conversationId?: string
    turnId?: string
  }): Promise<void> {
    await this.deps.repository.markManualRunStarted({
      runId: args.runId,
      userId: args.userId,
      conversationId: args.conversationId,
      turnId: args.turnId ?? `automation-${args.runId}-${Date.now()}`,
      now: this.clock.now(),
    })
  }

  async markRunCompleted(args: {
    runId: string
    userId: string
    conversationId?: string
  }): Promise<void> {
    await this.deps.repository.markManualRunCompleted({
      runId: args.runId,
      userId: args.userId,
      // Pass undefined (not '') so Convex's v.optional(v.id()) validator
      // accepts it. An empty string is not a valid Convex ID and will throw.
      conversationId: args.conversationId || undefined,
      now: this.clock.now(),
    })
  }

  async markRunFailed(args: {
    runId: string
    userId: string
    error: string
  }): Promise<void> {
    await this.deps.repository.markManualRunFailed({
      runId: args.runId,
      userId: args.userId,
      error: args.error,
      now: this.clock.now(),
    })
  }

  private assertScheduleAllowed(schedule: AutomationSchedule | undefined): void {
    if (scheduleTooFrequent(schedule)) {
      serviceError({ error: `Interval automations must run at least ${MIN_INTERVAL_MINUTES} minutes apart.` }, 400)
    }
  }

  private async assertProjectAllowsAutomation(
    projectId: string | undefined,
    userId: string,
  ): Promise<void> {
    if (!projectId || !this.deps.assertProjectAutomationAllowed) return
    if (!await this.deps.assertProjectAutomationAllowed({ projectId, userId })) {
      serviceError({ error: 'Automations are disabled for this project' }, 409)
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
    const conversationId = automation.sourceConversationId || automation.conversationId
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

  private async failManualRunBestEffort(args: {
    automationId: string | null
    error: unknown
    runId: string | null
    userId: string
  }): Promise<void> {
    const message = summarizeError(args.error).slice(0, 1000)
    if (args.runId) {
      await this.deps.repository.markManualRunFailed({
        runId: args.runId,
        userId: args.userId,
        error: message,
        now: this.clock.now(),
      }).catch((_error) => null)
    }
    if (args.runId && args.automationId) {
      this.events.failed({
        userId: args.userId,
        automationId: args.automationId,
        runId: args.runId,
        error: message,
      })
      await this.publishAutomationLifecycleEvent({
        automationId: args.automationId,
        execution: 'manual',
        failureClass: classifyAutomationFailure(args.error),
        name: 'automation.failed',
        runId: args.runId,
        userId: args.userId,
      })
    }
  }

  private async publishAutomationLifecycleEvent(args: {
    automationId: string
    execution: 'manual' | 'scheduled'
    failureClass?: 'authorization' | 'provider' | 'transient' | 'unknown' | 'validation'
    name: 'automation.failed' | 'automation.succeeded'
    runId: string
    userId: string
  }): Promise<void> {
    await this.deps.lifecycleEvents?.().publish({
      attributes: {
        execution: args.execution,
        ...(args.failureClass ? { failureClass: args.failureClass } : {}),
      },
      idempotencyKey: `${args.name}:${args.runId}`,
      name: args.name,
      resource: {
        automationId: args.automationId,
        id: args.runId,
        type: 'automation_run',
      },
      userId: args.userId,
    })
  }
}

function classifyAutomationFailure(
  error: unknown,
): 'authorization' | 'provider' | 'transient' | 'unknown' | 'validation' {
  if (error instanceof AutomationServiceError) {
    if (error.statusCode === 401 || error.statusCode === 403) return 'authorization'
    if (error.statusCode >= 400 && error.statusCode < 500) return 'validation'
  }
  if (error instanceof Error) {
    const name = error.name.toLowerCase()
    if (name.includes('timeout') || name.includes('network')) return 'transient'
    if (name.includes('provider') || name.includes('gateway')) return 'provider'
  }
  return 'unknown'
}
