import assert from 'node:assert/strict'
import test from 'node:test'
import { AutomationService, AutomationServiceError, buildAutomationUpdateNote } from './AutomationService'
import {
  PaidPlanAutomationEntitlementPolicy,
  type AutomationEntitlementPolicy,
} from './AutomationEntitlementPolicy'
import type { AutomationRepository } from './AutomationRepository'

function createRepository(overrides: Partial<AutomationRepository> = {}): AutomationRepository & {
  failedRuns: Array<Record<string, unknown>>
  updateNotes: Array<Record<string, unknown>>
} {
  const failedRuns: Array<Record<string, unknown>> = []
  const updateNotes: Array<Record<string, unknown>> = []
  return {
    failedRuns,
    updateNotes,
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
    async createAutomation() {
      return 'automation_1'
    },
    async updateAutomation() {},
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
    async markManualRunStarted() {},
    async markManualRunCompleted() {},
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
) {
  const finishedEvents: Array<Record<string, unknown>> = []
  const failedEvents: Array<Record<string, unknown>> = []
  return {
    finishedEvents,
    failedEvents,
    service: new AutomationService({
      entitlementPolicy,
      repository,
      clock: { now: () => 1_700_000_000_000 },
      events: {
        finished: (event) => finishedEvents.push(event),
        failed: (event) => failedEvents.push(event),
      },
      executor: async () => ({ conversationId: 'conversation_result' as never }),
    }),
  }
}

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
  const service = new AutomationService({
    entitlementPolicy: new PaidPlanAutomationEntitlementPolicy(async () => 'paid'),
    repository,
    clock: { now: () => 1_700_000_000_000 },
    events: {
      finished: () => {},
      failed: (event) => failedEvents.push(event),
    },
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
})
