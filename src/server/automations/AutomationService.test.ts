import assert from 'node:assert/strict'
import test from 'node:test'
import { AutomationService, AutomationServiceError, buildAutomationUpdateNote } from './AutomationService'
import {
  PaidPlanAutomationEntitlementPolicy,
  type AutomationEntitlementPolicy,
} from './AutomationEntitlementPolicy'
import type { AutomationRepository } from './AutomationRepository'
import { WorkspaceExecutionError, requireWorkspaceExecution } from '@/server/billing/WorkspaceExecutionPolicy'
import { LifecycleEventPublisher, LIFECYCLE_EVENT_TOPIC } from '@/server/lifecycle-events'
import type { EventBus } from '@overlay/app-core'
import type { AutomationThreadTurnInput } from './AutomationService'

test('owner-fenced settlement retains the repository instance for its server credentials', async () => {
  const repository = createRepository({
    async settleManualRun(): Promise<boolean> {
      assert.equal(this, repository)
      return true
    },
  })
  const { service } = createService(repository)
  assert.equal(await service.settleRun({
    runId: 'run', userId: 'user', expectedWorkflowRunId: 'workflow', expectedStatus: 'running',
    expectedTurnId: 'turn', status: 'completed',
  }), true)
})

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
        sourceConversationId: 'conversation_source',
        conversationId: 'conversation_owned',
      } as never
    },
    async createAutomation(args) {
      createdAutomations.push(args)
      return 'automation_1'
    },
    async updateAutomation(args) {
      updatedAutomations.push(args)
    },
    async attachOwnedConversation() {},
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
    async bindThread() {
      return { conversationId: 'conversation_thread', kind: 'chat', workspaceId: 'workspace_1' }
    },
    async linkRunMessage() {},
    async getThreadRunOutcome() {
      return { status: 'pending' }
    },
    async getRunForExecution() {
      return {
        run: { _id: 'run_1', userId: 'user_1', status: 'running', scheduledFor: 1_700_000_000_000 },
        automation: {
          _id: 'automation_1',
          userId: 'user_1',
          workspaceId: 'workspace_1',
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
  requireExecution: typeof requireWorkspaceExecution = async () => ({ billingEnabled: false }) as never,
  threadTurnStarter?: (input: AutomationThreadTurnInput) => Promise<{ messageId: string }>,
) {
  const startedTurns: AutomationThreadTurnInput[] = []
  return {
    startedTurns,
    service: new AutomationService({
      entitlementPolicy,
      repository,
      requireExecution,
      clock: { now: () => 1_700_000_000_000 },
      threadTurnStarter: threadTurnStarter ?? (async (input) => {
        startedTurns.push(input)
        return { messageId: 'message_1' }
      }),
    }),
  }
}

const routeContext = { auth: { userId: 'user_1', authType: 'service' } } as never

/** A repository that records the thread-run ledger writes. */
function threadRunRepository(overrides: Partial<AutomationRepository> = {}) {
  const writes: Array<[string, Record<string, unknown>]> = []
  const repository = createRepository({
    async updateRunWorkflowRunId(args) { writes.push(['owner', args]) },
    async bindThread(args) {
      writes.push(['bind', args])
      return { conversationId: 'conversation_thread', kind: 'agent', workspaceId: 'workspace_1' }
    },
    async markManualRunStarted(args) { writes.push(['started', args]) },
    async linkRunMessage(args) { writes.push(['message', args]) },
    async settleManualRun(args) { writes.push(['settle', args]); return true },
    ...overrides,
  })
  return { repository, writes }
}

test('a new scheduled run persists and returns a workspace payment refusal', async () => {
  const repository = createRepository()
  const { service, startedTurns } = createService(repository, undefined, async (input) => {
    assert.equal(input.userId, 'user_1')
    assert.equal(input.workspaceId, 'workspace_1')
    throw new WorkspaceExecutionError({ state: 'payment_pending', canExecute: false }, true)
  })

  await assert.rejects(
    service.dispatchScheduledRun({ runId: 'run_1', serviceUserId: 'user_1', routeContext }),
    (error: unknown) => error instanceof AutomationServiceError
      && error.statusCode === 402
      && error.payload.code === 'payment_pending',
  )
  assert.equal(repository.failedRuns.length, 1)
  assert.equal(
    repository.failedRuns[0]?.error,
    'Your payment has not been confirmed yet. Your draft is saved.',
  )
  assert.deepEqual(startedTurns, [])
})

test('a duplicate delivery of a run that is still posting its message is refused without side effects', async () => {
  const { repository, writes } = threadRunRepository({
    async getRunForExecution() {
      return {
        run: { _id: 'run_1', userId: 'user_1', status: 'running', workflowRunId: 'automation-thread:run_1' },
        automation: { _id: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1', instructions: 'Do the task' },
      } as never
    },
  })
  const { service, startedTurns } = createService(repository, undefined, async () => {
    throw new Error('a duplicate delivery should not recheck admission')
  })

  await assert.rejects(
    service.dispatchScheduledRun({ runId: 'run_1', serviceUserId: 'user_1', routeContext }),
    (error: unknown) => error instanceof AutomationServiceError && error.statusCode === 409,
  )
  assert.deepEqual(writes, [])
  assert.deepEqual(startedTurns, [])
})

test('a scheduled run for another user is refused', async () => {
  const { repository, writes } = threadRunRepository()
  const { service } = createService(repository)
  await assert.rejects(
    service.dispatchScheduledRun({ runId: 'run_1', serviceUserId: 'user_2', routeContext }),
    (error: unknown) => error instanceof AutomationServiceError && error.statusCode === 401,
  )
  assert.deepEqual(writes, [])
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

test('AutomationService.getAutomations includes agent-bound automations', async () => {
  const agentAutomation = { _id: 'automation_agent', agentId: 'agent_1' }
  let excludeAgentBound: boolean | undefined = true
  const repository = createRepository({
    async listAutomations(args) {
      excludeAgentBound = args.excludeAgentBound
      return [agentAutomation] as never
    },
  })
  const { service } = createService(repository)

  const result = await service.getAutomations({ userId: 'user_1', workspaceId: 'workspace_1' })

  assert.deepEqual(result, [agentAutomation])
  assert.equal(excludeAgentBound, undefined)
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
    workspaceId: 'workspace_1',
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
  assert.equal(repository.createdAutomations[0]?.workspaceId, 'workspace_1')
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
    workspaceId: 'workspace_1',
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
    workspaceId: 'workspace_1',
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
  assert.equal(repository.updatedAutomations[0]?.workspaceId, 'workspace_1')
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

test('a scheduled run posts its instructions into the bound thread under its owner token', async () => {
  const { repository, writes } = threadRunRepository({
    async getRunForExecution() {
      return {
        run: { _id: 'run_1', userId: 'user_1', status: 'running', scheduledFor: 1_700_000_000_000 },
        automation: {
          _id: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1', name: 'Automation',
          instructions: '  Do the task  ', modelId: 'model_1', agentId: 'agent_1',
        },
      } as never
    },
  })
  const { service, startedTurns } = createService(repository)

  assert.deepEqual(await service.dispatchScheduledRun({ runId: 'run_1', serviceUserId: 'user_1', routeContext }), {
    ok: true, runId: 'run_1', conversationId: 'conversation_thread', threadKind: 'agent', agentId: 'agent_1',
  })
  assert.deepEqual(startedTurns, [{
    automationId: 'automation_1', runId: 'run_1', owner: 'automation-thread:run_1',
    turnId: 'automation-run:run_1', userId: 'user_1', instructions: 'Do the task', modelId: 'model_1',
    scheduledFor: 1_700_000_000_000,
    thread: { conversationId: 'conversation_thread', kind: 'agent', workspaceId: 'workspace_1' },
    routeContext,
  }])
  assert.deepEqual(writes, [
    ['owner', { runId: 'run_1', workflowRunId: 'automation-thread:run_1' }],
    ['bind', { automationId: 'automation_1', userId: 'user_1' }],
    ['started', {
      runId: 'run_1', userId: 'user_1', conversationId: 'conversation_thread', turnId: 'automation-run:run_1',
      expectedWorkflowRunId: 'automation-thread:run_1', now: 1_700_000_000_000,
    }],
    ['message', { runId: 'run_1', userId: 'user_1', expectedWorkflowRunId: 'automation-thread:run_1', messageId: 'message_1' }],
  ])
})

test('a manual run creates its ledger row, then posts into the thread the same way', async () => {
  const createdRuns: Array<Record<string, unknown>> = []
  const { repository, writes } = threadRunRepository({
    async createManualRun(args) {
      createdRuns.push(args)
      return 'run_manual' as never
    },
    async getRunForExecution(args) {
      assert.equal(args.runId, 'run_manual')
      return {
        run: { _id: 'run_manual', userId: 'user_1', status: 'queued', scheduledFor: 1_700_000_000_000 },
        automation: { _id: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1', instructions: 'Old instructions' },
      } as never
    },
  })
  const { service, startedTurns } = createService(repository)

  assert.deepEqual(await service.startManualRun({
    automationId: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1', routeContext,
  }), { ok: true, runId: 'run_manual', conversationId: 'conversation_thread', threadKind: 'agent' })
  assert.deepEqual(createdRuns, [{ automationId: 'automation_1', userId: 'user_1', scheduledFor: 1_700_000_000_000 }])
  assert.equal(startedTurns[0]?.turnId, 'automation-run:run_manual')
  assert.equal(startedTurns[0]?.instructions, 'Old instructions')
  assert.deepEqual(writes.map(([kind]) => kind), ['owner', 'bind', 'started', 'message'])
})

test('a manual run refuses an automation from another workspace before creating a run', async () => {
  let created = 0
  const { service } = createService(createRepository({
    async createManualRun() { created += 1; return 'run_1' as never },
    async getAutomation() {
      return { _id: 'automation_1', userId: 'user_1', workspaceId: 'workspace_other', instructions: 'x' } as never
    },
  }))
  await assert.rejects(
    service.startManualRun({ automationId: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1', routeContext }),
    (error: unknown) => error instanceof AutomationServiceError && error.statusCode === 404,
  )
  assert.equal(created, 0)
})

test('a run whose thread turn cannot start is settled as failed under its owner token', async () => {
  const { repository, writes } = threadRunRepository()
  const { service } = createService(repository, undefined, undefined, async () => {
    throw new Error('The chat turn did not start (503)')
  })
  await assert.rejects(
    service.dispatchScheduledRun({ runId: 'run_1', serviceUserId: 'user_1', routeContext }),
    /The chat turn did not start/,
  )
  assert.deepEqual(writes.at(-1), ['settle', {
    runId: 'run_1', userId: 'user_1', expectedWorkflowRunId: 'automation-thread:run_1', expectedStatus: 'running',
    expectedTurnId: 'automation-run:run_1', status: 'failed', error: 'The chat turn did not start (503)',
  }])
  assert.equal(writes.some(([kind]) => kind === 'message'), false)
})

test('a run that has posted its message settles from its thread turn, and waits while the turn is open', async () => {
  let outcome: Awaited<ReturnType<AutomationRepository['getThreadRunOutcome']>> = { status: 'pending' }
  const { repository, writes } = threadRunRepository({
    async getRunForExecution() {
      return {
        run: {
          _id: 'run_1', userId: 'user_1', status: 'running', workflowRunId: 'automation-thread:run_1',
          turnId: 'automation-run:run_1', conversationId: 'conversation_thread', messageId: 'message_1',
        },
        automation: { _id: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1', instructions: 'Do the task' },
      } as never
    },
    async getThreadRunOutcome() { return outcome },
  })
  const { service, startedTurns } = createService(repository)

  assert.deepEqual(await service.dispatchScheduledRun({ runId: 'run_1', serviceUserId: 'user_1', routeContext }), {
    ok: true, runId: 'run_1', settled: false,
  })
  assert.deepEqual(writes, [])

  outcome = { status: 'failed', error: 'Model refused' }
  assert.deepEqual(await service.dispatchScheduledRun({ runId: 'run_1', serviceUserId: 'user_1', routeContext }), {
    ok: true, runId: 'run_1', settled: true, status: 'failed',
  })
  assert.deepEqual(writes, [['settle', {
    runId: 'run_1', userId: 'user_1', expectedWorkflowRunId: 'automation-thread:run_1', expectedStatus: 'running',
    expectedTurnId: 'automation-run:run_1', status: 'failed', conversationId: 'conversation_thread', error: 'Model refused',
  }]])
  assert.deepEqual(startedTurns, [])
})

test('a manual run refuses a missing, deleted or empty automation before creating a run', async () => {
  let created = 0
  const base = { async createManualRun() { created += 1; return 'run_1' as never } }
  await assert.rejects(
    createService(createRepository(base)).service.startManualRun({ userId: 'user_1', workspaceId: 'workspace_1', routeContext }),
    (error: unknown) => error instanceof AutomationServiceError && error.statusCode === 400,
  )
  await assert.rejects(
    createService(createRepository({ ...base, async getAutomation() { return null } }))
      .service.startManualRun({ automationId: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1', routeContext }),
    (error: unknown) => error instanceof AutomationServiceError && error.statusCode === 404,
  )
  await assert.rejects(
    createService(createRepository({ ...base, async getAutomation() {
      return { _id: 'automation_1', userId: 'user_1', instructions: 'x', deletedAt: 1 } as never
    } })).service.startManualRun({ automationId: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1', routeContext }),
    (error: unknown) => error instanceof AutomationServiceError && error.statusCode === 404,
  )
  await assert.rejects(
    createService(createRepository({ ...base, async getAutomation() {
      return { _id: 'automation_1', userId: 'user_1', instructions: '   ' } as never
    } })).service.startManualRun({ automationId: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1', routeContext }),
    (error: unknown) => error instanceof AutomationServiceError && error.statusCode === 400,
  )
  assert.equal(created, 0)
})

test('enabling an automation checks the plan of the workspace it is created in', async () => {
  const checked: Array<Record<string, unknown>> = []
  const { service } = createService(createRepository(), {
    async assertCanEnable(args) { checked.push(args) },
  })
  await service.createAutomation({
    userId: 'user_1',
    workspaceId: 'workspace_team',
    body: { name: 'A', description: 'B', instructions: 'C', schedule: { kind: 'interval', intervalMinutes: 60 } },
  })
  assert.deepEqual(checked, [{ enabledCount: 0, userId: 'user_1', workspaceId: 'workspace_team' }])
})

// ---------------------------------------------------------------------------
// Durable execution helpers
// ---------------------------------------------------------------------------

test('AutomationService.getAutomationForExecution delegates to repository.getAutomation', async () => {
  const repository = createRepository({
    async getAutomation(args) {
      return {
        _id: args.automationId,
        userId: args.userId,
        name: 'Durable automation',
        instructions: 'Do something durable',
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
    turnId: 'automation-run:run_1',
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

test('AutomationService.attachOwnedConversation delegates to repository', async () => {
  const links: Array<{ automationId: string; conversationId: string; userId: string }> = []
  const repository = createRepository({
    async attachOwnedConversation(args) {
      links.push(args)
    },
  })
  const { service } = createService(repository)

  await service.attachOwnedConversation({
    automationId: 'automation_1',
    conversationId: 'conversation_1',
    userId: 'user_1',
  })

  assert.deepEqual(links, [{
    automationId: 'automation_1',
    conversationId: 'conversation_1',
    userId: 'user_1',
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

// ---------------------------------------------------------------------------
// Convex path parity: markRunCompleted must pass undefined (not '') for
// conversationId so Convex's v.optional(v.id()) validator accepts it.
// ---------------------------------------------------------------------------

test('AutomationService.markRunCompleted passes undefined (not empty string) when conversationId is missing', async () => {
  const repository = createRepository()
  const { service } = createService(repository)

  await service.markRunCompleted({
    runId: 'run_1',
    userId: 'user_1',
    // No conversationId — should pass undefined, not ''
  })

  assert.equal(repository.completedRuns.length, 1)
  assert.equal(repository.completedRuns[0]?.conversationId, undefined)
  assert.notEqual(repository.completedRuns[0]?.conversationId, '')
})

test('AutomationService.markRunCompleted passes the conversationId when provided', async () => {
  const repository = createRepository()
  const { service } = createService(repository)

  await service.markRunCompleted({
    runId: 'run_1',
    userId: 'user_1',
    conversationId: 'conv_123',
  })

  assert.equal(repository.completedRuns.length, 1)
  assert.equal(repository.completedRuns[0]?.conversationId, 'conv_123')
})

// ---------------------------------------------------------------------------
// Scheduler cancellation: deleteAutomation and pause action should cancel
// the active scheduler workflow.
// ---------------------------------------------------------------------------

test('AutomationService.updateAutomation posts update notes to the owned thread', async () => {
  const repository = createRepository()
  const { service } = createService(repository)

  await service.updateAutomation({
    userId: 'user_1',
    body: { automationId: 'automation_1', name: 'New name' },
  })

  assert.equal(repository.updateNotes.length, 1)
  assert.equal(repository.updateNotes[0]?.conversationId, 'conversation_owned')
})

test('AutomationService.updateAutomation skips update note when no owned thread exists', async () => {
  const repository = createRepository({
    async getAutomation() {
      return {
        _id: 'automation_1',
        userId: 'user_1',
        name: 'Old name',
        instructions: 'Old instructions',
        sourceConversationId: 'conversation_source',
      } as never
    },
  })
  const { service } = createService(repository)

  await service.updateAutomation({
    userId: 'user_1',
    body: { automationId: 'automation_1', name: 'New name' },
  })

  assert.equal(repository.updateNotes.length, 0)
})

test('AutomationService.deleteAutomation removes only the owned conversation, never the source', async () => {
  const removedConversations: string[] = []
  const repository = createRepository({
    async getAutomation() {
      return {
        _id: 'automation_1',
        userId: 'user_1',
        name: 'Test automation',
        instructions: 'Do things',
        sourceConversationId: 'conversation_source',
        conversationId: 'conversation_owned',
      } as never
    },
    async removeConversation(args) {
      removedConversations.push(args.conversationId)
    },
  })
  const { service } = createService(repository)

  const result = await service.deleteAutomation({
    automationId: 'automation_1',
    userId: 'user_1',
  })

  assert.deepEqual(removedConversations, ['conversation_owned'])
  assert.deepEqual(result.linkedConversationIds, ['conversation_owned'])
})

test('AutomationService.deleteAutomation never deletes a shared source thread (legacy hijacked rows)', async () => {
  const removedConversations: string[] = []
  const repository = createRepository({
    async getAutomation() {
      return {
        _id: 'automation_1',
        userId: 'user_1',
        name: 'Test automation',
        instructions: 'Do things',
        // Legacy row: the shared source thread was stamped as the run target.
        sourceConversationId: 'conversation_shared',
        conversationId: 'conversation_shared',
      } as never
    },
    async removeConversation(args) {
      removedConversations.push(args.conversationId)
    },
  })
  const { service } = createService(repository)

  const result = await service.deleteAutomation({
    automationId: 'automation_1',
    userId: 'user_1',
  })

  assert.deepEqual(removedConversations, [])
  assert.deepEqual(result.linkedConversationIds, [])
})

test('AutomationService.updateAutomation refuses a save from an older version before any side effect', async () => {
  const repository = createRepository()
  const { service } = createService(repository)
  await assert.rejects(
    service.updateAutomation({
      userId: 'user_1',
      workspaceId: 'workspace_1',
      body: { automationId: 'automation_1', name: 'Stale', enabled: false, expectedUpdatedAt: 5 },
    }),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 409,
  )
  assert.equal(repository.updatedAutomations.length, 0)
  assert.equal(repository.updateNotes.length, 0)
})

// ---------------------------------------------------------------------------
// Run outcome lifecycle events (failure email, audit, metrics)
// ---------------------------------------------------------------------------

class CapturingEventBus implements EventBus {
  readonly events: Array<{ payload: unknown; topic: string }> = []
  async publish(topic: string, payload: unknown): Promise<void> { this.events.push({ topic, payload }) }
  subscribe(): () => void { return () => {} }
}

function settlingService(settled: boolean, triggerSource?: string) {
  const eventBus = new CapturingEventBus()
  const repository = createRepository({
    async settleManualRun() { return settled },
    async getRunForExecution() {
      return {
        run: { _id: 'run_1', userId: 'user_1', status: 'failed', scheduledFor: 1, ...(triggerSource ? { triggerSource } : {}) },
        automation: { _id: 'automation_1', userId: 'user_1', name: 'Daily digest', instructions: 'secret instructions' },
      } as never
    },
  })
  const service = new AutomationService({
    entitlementPolicy: new PaidPlanAutomationEntitlementPolicy(async () => 'paid'),
    repository,
    lifecycleEvents: () => new LifecycleEventPublisher({ eventBus }),
  })
  const settle = (status: 'completed' | 'failed' | 'cancelled' | 'skipped') => service.settleRun({
    runId: 'run_1', userId: 'user_1', expectedWorkflowRunId: 'workflow', expectedStatus: 'running', status,
  })
  const published = () => eventBus.events.filter(e => e.topic === LIFECYCLE_EVENT_TOPIC).map(e => {
    const p = e.payload as { name: string; attributes: unknown; resource: unknown; idempotencyKey: string }
    return { name: p.name, attributes: p.attributes, resource: p.resource, idempotencyKey: p.idempotencyKey }
  })
  return { settle, published }
}

test('a failed run publishes automation.failed once settled, without automation content', async () => {
  const { settle, published } = settlingService(true)
  assert.equal(await settle('failed'), true)
  assert.deepEqual(published(), [{
    name: 'automation.failed',
    attributes: { execution: 'scheduled', automationName: 'Daily digest', failureClass: 'unknown' },
    resource: { automationId: 'automation_1', id: 'run_1', type: 'automation_run' },
    idempotencyKey: 'automation.failed:run_1',
  }])
  assert.ok(!JSON.stringify(published()).includes('secret instructions'))
})

test('a completed manual run publishes automation.succeeded', async () => {
  const { settle, published } = settlingService(true, 'manual')
  await settle('completed')
  assert.deepEqual(published().map(e => [e.name, e.attributes]), [
    ['automation.succeeded', { execution: 'manual', automationName: 'Daily digest' }],
  ])
})

test('no event when settlement lost its owner fence, or for cancelled and skipped runs', async () => {
  const lost = settlingService(false)
  assert.equal(await lost.settle('failed'), false)
  assert.deepEqual(lost.published(), [])
  const other = settlingService(true)
  await other.settle('cancelled')
  await other.settle('skipped')
  assert.deepEqual(other.published(), [])
})
