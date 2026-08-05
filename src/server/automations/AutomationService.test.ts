import assert from 'node:assert/strict'
import test from 'node:test'
import { AutomationService, AutomationServiceError, buildAutomationUpdateNote } from './AutomationService'
import {
  PaidPlanAutomationEntitlementPolicy,
  type AutomationEntitlementPolicy,
} from './AutomationEntitlementPolicy'
import type { AutomationRepository } from './AutomationRepository'
import { LifecycleEventPublisher, LIFECYCLE_EVENT_TOPIC } from '@/server/lifecycle-events'
import type { EventBus } from '@overlay/app-core'

class CapturingEventBus implements EventBus {
  readonly events: Array<{ payload: unknown; topic: string }> = []

  async publish(topic: string, payload: unknown): Promise<void> {
    this.events.push({ topic, payload })
  }

  subscribe(): () => void {
    return () => {}
  }
}

function createRepository(overrides: Partial<AutomationRepository> = {}): AutomationRepository & {
  createdAutomations: Array<Record<string, unknown>>
  failedRuns: Array<Record<string, unknown>>
  startedRuns: Array<Record<string, unknown>>
  completedRuns: Array<Record<string, unknown>>
  updateNotes: Array<Record<string, unknown>>
  updatedAutomations: Array<Record<string, unknown>>
} {
  const createdAutomations: Array<Record<string, unknown>> = []
  const failedRuns: Array<Record<string, unknown>> = []
  const startedRuns: Array<Record<string, unknown>> = []
  const completedRuns: Array<Record<string, unknown>> = []
  const updateNotes: Array<Record<string, unknown>> = []
  const updatedAutomations: Array<Record<string, unknown>> = []
  return {
    createdAutomations,
    failedRuns,
    startedRuns,
    completedRuns,
    updateNotes,
    updatedAutomations,
    async listAutomations() {
      return []
    },
    async listRuns() {
      return []
    },
    async getAutomation() {
      return {
        _id: 'automation_1',
        userId: 'user_1',
        name: 'Old name',
        description: 'Old description',
        instructions: 'Old instructions',
        schedule: { kind: 'daily', hourUTC: 9, minuteUTC: 0 },
        sourceConversationId: 'conversation_1',
      } as never
    },
    async getAutomationRunTarget() {
      return {
        _id: 'automation_1',
        userId: 'user_1',
        name: 'Automation',
        instructions: 'Do the task',
        sourceConversationId: 'conversation_1',
      } as never
    },
    async createAutomation(args) {
      createdAutomations.push(args)
      return 'automation_1'
    },
    async updateAutomation(args) {
      updatedAutomations.push(args)
    },
    async pauseAutomation() {},
    async resumeAutomation() {},
    async removeAutomation() {},
    async requestRunCancellation() { return true },
    async retryRun() { return 'run_retry_1' },
    async removeConversation() {},
    async appendAutomationUpdateNote(args) {
      updateNotes.push(args)
    },
    async createManualRun() {
      return 'run_1' as never
    },
    async markManualRunStarted(args) {
      startedRuns.push(args)
    },
    async markManualRunCompleted(args) {
      completedRuns.push(args)
    },
    async markManualRunFailed(args) {
      failedRuns.push(args)
    },
    async getRunForExecution() {
      return {
        run: { status: 'running', scheduledFor: 1_700_000_000_000 },
        automation: {
          _id: 'automation_1',
          userId: 'user_1',
          name: 'Automation',
          instructions: 'Do the task',
          sourceConversationId: 'conversation_1',
        },
      } as never
    },
    ...overrides,
  }
}

function createService(
  repository = createRepository(),
  entitlementPolicy: AutomationEntitlementPolicy = new PaidPlanAutomationEntitlementPolicy(
    async () => 'paid',
  ),
  projectPolicyOrLifecycleEvents?:
    | ((args: { projectId: string; userId: string }) => Promise<boolean>)
    | LifecycleEventPublisher,
  lifecycleEvents?: LifecycleEventPublisher,
) {
  const assertProjectAutomationAllowed = typeof projectPolicyOrLifecycleEvents === 'function'
    ? projectPolicyOrLifecycleEvents
    : undefined
  const resolvedLifecycleEvents = typeof projectPolicyOrLifecycleEvents === 'function'
    ? lifecycleEvents
    : projectPolicyOrLifecycleEvents
  const finishedEvents: Array<Record<string, unknown>> = []
  const failedEvents: Array<Record<string, unknown>> = []
  return {
    finishedEvents,
    failedEvents,
    service: new AutomationService({
      assertProjectAutomationAllowed,
      entitlementPolicy,
      repository,
      clock: { now: () => 1_700_000_000_000 },
      events: {
        finished: (event) => finishedEvents.push(event),
        failed: (event) => failedEvents.push(event),
      },
      lifecycleEvents: resolvedLifecycleEvents ? () => resolvedLifecycleEvents : undefined,
      executor: async () => ({ conversationId: 'conversation_result' as never }),
    }),
  }
}

test('AutomationService rejects project execution when project policy disables automations', async () => {
  const { service } = createService(
    createRepository(),
    undefined,
    async () => false,
  )

  await assert.rejects(
    () => service.createAutomation({
      userId: 'user_1',
      body: {
        name: 'A',
        description: 'D',
        instructions: 'I',
        projectId: 'project_1',
        schedule: { kind: 'daily' },
      },
    }),
    (error) =>
      error instanceof AutomationServiceError &&
      error.statusCode === 409 &&
      error.payload.error === 'Automations are disabled for this project',
  )
})

test('AutomationService.createAutomation preserves paid-plan requirement', async () => {
  const repository = createRepository()
  const { service } = createService(
    repository,
    new PaidPlanAutomationEntitlementPolicy(async () => 'free'),
  )

  await assert.rejects(
    () => service.createAutomation({
      userId: 'user_1',
      body: {
        name: 'A',
        description: 'D',
        instructions: 'I',
        schedule: { kind: 'daily' },
      },
    }),
    (error) =>
      error instanceof AutomationServiceError &&
      error.statusCode === 403 &&
      error.payload.error === 'Enabled automations require a paid plan.',
  )
})

test('AutomationService.createAutomation preserves interval floor response shape', async () => {
  const { service } = createService()

  await assert.rejects(
    () => service.createAutomation({
      userId: 'user_1',
      body: {
        name: 'A',
        description: 'D',
        instructions: 'I',
        schedule: { kind: 'interval', intervalMinutes: 5 },
      },
    }),
    (error) =>
      error instanceof AutomationServiceError &&
      error.statusCode === 400 &&
      error.payload.error === 'Interval automations must run at least 15 minutes apart.',
  )
})

test('AutomationService.createAutomation parses a stringified schedule before persistence', async () => {
  const repository = createRepository()
  const { service } = createService(repository)

  await service.createAutomation({
    userId: 'user_1',
    body: {
      name: 'A',
      description: 'D',
      instructions: 'I',
      schedule: JSON.stringify({ kind: 'daily', hourUTC: 9, minuteUTC: 30 }) as never,
      enabled: false,
    },
  })

  assert.deepEqual(repository.createdAutomations[0]?.schedule, {
    kind: 'daily',
    hourUTC: 9,
    minuteUTC: 30,
  })
})

test('buildAutomationUpdateNote preserves update note wording', () => {
  const note = buildAutomationUpdateNote({
    _id: 'automation_1' as never,
    userId: 'user_1',
    name: 'Old name',
    description: 'Old description',
    instructions: 'Old instructions',
    enabled: true,
    modelId: 'old-model',
    createdAt: 1,
    updatedAt: 1,
  }, {
    name: 'New name',
    description: 'New description',
    instructions: 'New instructions',
    enabled: false,
    modelId: 'new-model',
  })

  assert.equal(
    note,
    'Automation updated: name changed to "New name"; description updated; instructions updated; paused; model changed to new-model.',
  )
})

test('AutomationService.updateAutomation appends update note best effort', async () => {
  const repository = createRepository()
  const { service } = createService(repository)

  await service.updateAutomation({
    userId: 'user_1',
    body: {
      automationId: 'automation_1',
      name: 'New name',
    },
  })

  assert.equal(repository.updateNotes.length, 1)
  assert.equal(repository.updateNotes[0]?.content, 'Automation updated: name changed to "New name".')
})

test('AutomationService.updateAutomation parses a stringified schedule before persistence', async () => {
  const repository = createRepository()
  const { service } = createService(repository)

  await service.updateAutomation({
    userId: 'user_1',
    body: {
      automationId: 'automation_1',
      schedule: JSON.stringify({ kind: 'weekly', dayOfWeekUTC: 2, hourUTC: 10, minuteUTC: 15 }) as never,
    },
  })

  assert.deepEqual(repository.updatedAutomations[0]?.schedule, {
    kind: 'weekly',
    dayOfWeekUTC: 2,
    hourUTC: 10,
    minuteUTC: 15,
  })
})

test('AutomationService exposes durable run cancellation and retry actions', async () => {
  const cancelled: string[] = []
  const retried: string[] = []
  const repository = createRepository({
    async requestRunCancellation(args) {
      cancelled.push(args.runId)
      return true
    },
    async retryRun(args) {
      retried.push(args.runId)
      return 'retry_run'
    },
  })
  const { service } = createService(repository)
  assert.deepEqual(await service.updateAutomation({
    body: { action: 'cancel-run', runId: 'run_1' },
    userId: 'user_1',
  }), { success: true })
  assert.deepEqual(await service.updateAutomation({
    body: { action: 'retry-run', runId: 'run_2' },
    userId: 'user_1',
  }), { success: true })
  assert.deepEqual(cancelled, ['run_1'])
  assert.deepEqual(retried, ['run_2'])
})

test('AutomationService.testAutomation marks run failed and emits failure on executor error', async () => {
  const repository = createRepository()
  const failedEvents: Array<Record<string, unknown>> = []
  const eventBus = new CapturingEventBus()
  const service = new AutomationService({
    entitlementPolicy: new PaidPlanAutomationEntitlementPolicy(async () => 'paid'),
    repository,
    clock: { now: () => 1_700_000_000_000 },
    events: {
      finished: () => {},
      failed: (event) => failedEvents.push(event),
    },
    lifecycleEvents: () => new LifecycleEventPublisher({ eventBus }),
    executor: async () => {
      throw new Error('executor failed')
    },
  })

  await assert.rejects(
    () => service.testAutomation({ userId: 'user_1', automationId: 'automation_1' }),
    /executor failed/,
  )

  assert.equal(repository.failedRuns.length, 1)
  assert.equal(repository.failedRuns[0]?.error, 'executor failed')
  assert.equal(failedEvents.length, 1)
  assert.equal(failedEvents[0]?.error, 'executor failed')
  assert.equal(eventBus.events[0]?.topic, LIFECYCLE_EVENT_TOPIC)
  assert.deepEqual(eventBus.events[0]?.payload, {
    attributes: { execution: 'manual', failureClass: 'unknown' },
    classification: 'operational',
    destinations: ['analytics', 'audit', 'email', 'metrics', 'notification'],
    eventId: (eventBus.events[0]?.payload as { eventId: string }).eventId,
    idempotencyKey: 'automation.failed:run_1',
    name: 'automation.failed',
    occurredAt: (eventBus.events[0]?.payload as { occurredAt: number }).occurredAt,
    resource: { automationId: 'automation_1', id: 'run_1', type: 'automation_run' },
    schemaVersion: 1,
    userId: 'user_1',
  })
})

test('AutomationService publishes successful run metadata without automation content', async () => {
  const eventBus = new CapturingEventBus()
  const { service } = createService(
    createRepository(),
    new PaidPlanAutomationEntitlementPolicy(async () => 'paid'),
    new LifecycleEventPublisher({ eventBus }),
  )

  await service.testAutomation({ userId: 'user_1', automationId: 'automation_1' })

  assert.equal(eventBus.events[0]?.topic, LIFECYCLE_EVENT_TOPIC)
  assert.deepEqual(
    eventBus.events.map((event) => {
      const payload = event.payload as { attributes: unknown; name: string; resource: unknown }
      return { attributes: payload.attributes, name: payload.name, resource: payload.resource }
    }),
    [{
      attributes: { execution: 'manual' },
      name: 'automation.succeeded',
      resource: { automationId: 'automation_1', id: 'run_1', type: 'automation_run' },
    }],
  )
})

// ---------------------------------------------------------------------------
// Durable execution helpers — used by POST /api/v1/automations/{id}/run
// ---------------------------------------------------------------------------

test('AutomationService.createManualRunForDurableExecution delegates to repository.createManualRun', async () => {
  const repository = createRepository({
    async createManualRun(args) {
      return `durable_${args.automationId}_${args.userId}` as never
    },
  })
  const { service } = createService(repository)

  const runId = await service.createManualRunForDurableExecution({
    automationId: 'automation_1',
    userId: 'user_1',
  })

  assert.equal(runId, 'durable_automation_1_user_1')
})

test('AutomationService.getAutomationForExecution delegates to repository.getAutomation', async () => {
  const repository = createRepository({
    async getAutomation(args) {
      return {
        _id: args.automationId,
        userId: args.userId,
        name: 'Durable automation',
        instructions: 'Do something durable',
        projectId: 'project_1',
        modelId: 'gpt-4o',
        conversationId: 'conv_1',
      } as never
    },
  })
  const { service } = createService(repository)

  const automation = await service.getAutomationForExecution({
    automationId: 'automation_1',
    userId: 'user_1',
  })

  assert.equal(automation?._id, 'automation_1')
  assert.equal(automation?.name, 'Durable automation')
  assert.equal(automation?.modelId, 'gpt-4o')
})

test('AutomationService syncs durable run lifecycle status through the repository', async () => {
  const repository = createRepository()
  const { service } = createService(repository)

  await service.markRunStarted({
    runId: 'run_1',
    userId: 'user_1',
    conversationId: 'conversation_1',
    turnId: 'turn_1',
  })
  await service.markRunCompleted({
    runId: 'run_1',
    userId: 'user_1',
    conversationId: 'conversation_1',
  })
  await service.markRunFailed({
    runId: 'run_2',
    userId: 'user_1',
    error: 'workflow failed',
  })

  assert.deepEqual(repository.startedRuns, [{
    runId: 'run_1',
    userId: 'user_1',
    conversationId: 'conversation_1',
    turnId: 'turn_1',
    now: 1_700_000_000_000,
  }])
  assert.deepEqual(repository.completedRuns, [{
    runId: 'run_1',
    userId: 'user_1',
    conversationId: 'conversation_1',
    now: 1_700_000_000_000,
  }])
  assert.deepEqual(repository.failedRuns, [{
    runId: 'run_2',
    userId: 'user_1',
    error: 'workflow failed',
    now: 1_700_000_000_000,
  }])
})

test('AutomationService.updateRunWorkflowRunId delegates to repository when supported', async () => {
  const updates: Array<{ runId: string; workflowRunId: string }> = []
  const repository = createRepository({
    async updateRunWorkflowRunId(args) {
      updates.push(args)
    },
  })
  const { service } = createService(repository)

  await service.updateRunWorkflowRunId({
    runId: 'run_1',
    workflowRunId: 'wfrun_abc',
  })

  assert.equal(updates.length, 1)
  assert.equal(updates[0]?.runId, 'run_1')
  assert.equal(updates[0]?.workflowRunId, 'wfrun_abc')
})

test('AutomationService.updateRunWorkflowRunId is a no-op when repository does not support it', async () => {
  const repository = createRepository()
  // createRepository does NOT provide updateRunWorkflowRunId — the optional
  // method should be safely skipped.
  const { service } = createService(repository)

  // Should not throw
  await service.updateRunWorkflowRunId({
    runId: 'run_1',
    workflowRunId: 'wfrun_abc',
  })
})
