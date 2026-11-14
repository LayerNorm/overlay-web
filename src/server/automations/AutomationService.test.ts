import assert from 'node:assert/strict'
import test from 'node:test'
import { AutomationService, AutomationServiceError, buildAutomationUpdateNote } from './AutomationService'
import {
  PaidPlanAutomationEntitlementPolicy,
  type AutomationEntitlementPolicy,
} from './AutomationEntitlementPolicy'
import type { AutomationRepository } from './AutomationRepository'
import { WorkspaceExecutionError, requireWorkspaceExecution } from '@/server/billing/WorkspaceExecutionPolicy'
import type { AutomationRunWorkflowInput } from '@/server/workflows/automation-run'

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
    async getRunForExecution() {
      return {
        run: { _id: 'run_1', status: 'running', scheduledFor: 1_700_000_000_000 },
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
  automationWorkflowStarter?: (input: AutomationRunWorkflowInput) => Promise<{ runId: string }>,
) {
  const startedWorkflows: AutomationRunWorkflowInput[] = []
  return {
    startedWorkflows,
    service: new AutomationService({
      entitlementPolicy,
      repository,
      requireExecution,
      clock: { now: () => 1_700_000_000_000 },
      automationWorkflowStarter: automationWorkflowStarter ?? (async (input) => {
        startedWorkflows.push(input)
        return { runId: 'workflow_1' }
      }),
    }),
  }
}

test('a new durable scheduled run persists and returns a workspace payment refusal', async () => {
  const repository = createRepository()
  const { service } = createService(repository, undefined, async (input) => {
    assert.equal(input.userId, 'user_1')
    assert.equal(input.workspaceId, 'workspace_1')
    throw new WorkspaceExecutionError({ state: 'payment_pending', canExecute: false }, true)
  })

  await assert.rejects(
    service.startDurableScheduledRun({ runId: 'run_1', serviceUserId: 'user_1', baseUrl: 'https://app.example' }),
    (error: unknown) => error instanceof AutomationServiceError
      && error.statusCode === 402
      && error.payload.code === 'payment_pending',
  )
  assert.equal(repository.failedRuns.length, 1)
  assert.equal(
    repository.failedRuns[0]?.error,
    'Your payment has not been confirmed yet. Your draft is saved.',
  )
})

test('an existing durable workflow replay skips new workspace admission', async () => {
  const repository = createRepository({
    async getRunForExecution() {
      return {
        run: { _id: 'run_1', status: 'running', workflowRunId: 'workflow_existing' },
        automation: { _id: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1' },
      } as never
    },
  })
  const { service } = createService(repository, undefined, async () => {
    throw new Error('replay should not recheck new-run admission')
  })

  assert.deepEqual(await service.startDurableScheduledRun({
    runId: 'run_1',
    serviceUserId: 'user_1',
    baseUrl: 'https://app.example',
  }), {
    ok: true,
    durable: true,
    runId: 'run_1',
    workflowRunId: 'workflow_existing',
  })
  assert.equal(repository.failedRuns.length, 0)
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

test('a scheduled run starts the run workflow with the run identity and owned thread', async () => {
  const repository = createRepository({
    async getRunForExecution() {
      return {
        run: { _id: 'run_1', status: 'running', scheduledFor: 1_700_000_000_000 },
        automation: {
          _id: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1', name: 'Automation',
          instructions: 'Do the task', modelId: 'model_1',
          sourceConversationId: 'conversation_source', conversationId: 'conversation_owned',
        },
      } as never
    },
    async updateRunWorkflowRunId(args) { recorded.push(args) },
  })
  const recorded: Array<{ runId: string; workflowRunId: string }> = []
  const { service, startedWorkflows } = createService(repository)

  assert.deepEqual(await service.startDurableScheduledRun({
    runId: 'run_1', serviceUserId: 'user_1', baseUrl: 'https://app.example',
  }), { ok: true, durable: true, runId: 'run_1', workflowRunId: 'workflow_1' })
  assert.deepEqual(startedWorkflows, [{
    automationId: 'automation_1', runId: 'run_1', userId: 'user_1', name: 'Automation',
    description: '', instructions: 'Do the task', modelId: 'model_1',
    conversationId: 'conversation_owned', workspaceId: 'workspace_1', scheduledFor: 1_700_000_000_000,
  }])
  assert.deepEqual(recorded, [{ runId: 'run_1', workflowRunId: 'workflow_1' }])
})

test('a manual run creates its run row, then starts the same run workflow', async () => {
  const createdRuns: Array<Record<string, unknown>> = []
  const recorded: Array<{ runId: string; workflowRunId: string }> = []
  const repository = createRepository({
    async createManualRun(args) {
      createdRuns.push(args)
      return 'run_manual' as never
    },
    async updateRunWorkflowRunId(args) { recorded.push(args) },
  })
  const { service, startedWorkflows } = createService(repository)

  assert.deepEqual(await service.startManualRun({
    automationId: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1',
  }), { ok: true, durable: true, runId: 'run_manual', workflowRunId: 'workflow_1' })
  assert.deepEqual(createdRuns, [{ automationId: 'automation_1', userId: 'user_1', scheduledFor: 1_700_000_000_000 }])
  assert.deepEqual(startedWorkflows, [{
    automationId: 'automation_1', runId: 'run_manual', userId: 'user_1', name: 'Old name',
    description: 'Old description', instructions: 'Old instructions', modelId: undefined,
    conversationId: 'conversation_owned', workspaceId: 'workspace_1', scheduledFor: 1_700_000_000_000,
  }])
  assert.deepEqual(recorded, [{ runId: 'run_manual', workflowRunId: 'workflow_1' }])
})

test('runs never target the source chat, even on older rows that stored it as the thread', async () => {
  const repository = createRepository({
    async getAutomation() {
      return {
        _id: 'automation_1', userId: 'user_1', name: 'Automation', instructions: 'Do the task',
        sourceConversationId: 'conversation_source', conversationId: 'conversation_source',
      } as never
    },
  })
  const { service, startedWorkflows } = createService(repository)
  await service.startManualRun({ automationId: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1' })
  assert.equal(startedWorkflows[0]?.conversationId, undefined)
})

test('a manual run of an automation with condition nodes waits for approval', async () => {
  const repository = createRepository({
    async getAutomation() {
      return {
        _id: 'automation_1', userId: 'user_1', name: 'Automation', instructions: 'Do the task',
        graph: { nodes: [{ kind: 'prompt' }, { kind: 'condition' }] },
      } as never
    },
  })
  const { service, startedWorkflows } = createService(repository)
  const result = await service.startManualRun({ automationId: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1' })
  assert.equal(result.approvalRequired, true)
  assert.equal(result.approvalToken, 'automation-approval:automation_1:1700000000000')
  assert.equal(startedWorkflows[0]?.approvalToken, result.approvalToken)
  assert.equal(startedWorkflows[0]?.approvalTimeoutMs, 24 * 60 * 60_000)
})

test('a manual run that cannot start its workflow is marked failed', async () => {
  const repository = createRepository()
  const { service } = createService(repository, undefined, undefined, async () => {
    throw new Error('workflow start failed')
  })
  await assert.rejects(
    service.startManualRun({ automationId: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1' }),
    /workflow start failed/,
  )
  assert.deepEqual(repository.failedRuns, [{
    runId: 'run_1', userId: 'user_1', error: 'workflow start failed', now: 1_700_000_000_000,
  }])
})

test('a manual run refuses a missing, deleted or empty automation before creating a run', async () => {
  let created = 0
  const base = { async createManualRun() { created += 1; return 'run_1' as never } }
  await assert.rejects(
    createService(createRepository(base)).service.startManualRun({ userId: 'user_1', workspaceId: 'workspace_1' }),
    (error: unknown) => error instanceof AutomationServiceError && error.statusCode === 400,
  )
  await assert.rejects(
    createService(createRepository({ ...base, async getAutomation() { return null } }))
      .service.startManualRun({ automationId: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1' }),
    (error: unknown) => error instanceof AutomationServiceError && error.statusCode === 404,
  )
  await assert.rejects(
    createService(createRepository({ ...base, async getAutomation() {
      return { _id: 'automation_1', userId: 'user_1', instructions: 'x', deletedAt: 1 } as never
    } })).service.startManualRun({ automationId: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1' }),
    (error: unknown) => error instanceof AutomationServiceError && error.statusCode === 404,
  )
  await assert.rejects(
    createService(createRepository({ ...base, async getAutomation() {
      return { _id: 'automation_1', userId: 'user_1', instructions: '   ' } as never
    } })).service.startManualRun({ automationId: 'automation_1', userId: 'user_1', workspaceId: 'workspace_1' }),
    (error: unknown) => error instanceof AutomationServiceError && error.statusCode === 400,
  )
  assert.equal(created, 0)
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
