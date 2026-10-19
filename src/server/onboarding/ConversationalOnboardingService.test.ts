import { strict as assert } from 'node:assert'
import test from 'node:test'
import { WorkServiceError } from '@/server/work/WorkService'
import { OnboardingActionSchema, type OnboardingAction, type OnboardingSession } from '@/shared/onboarding/session'
import { ConversationalOnboardingService, type OnboardingEffects } from './ConversationalOnboardingService'
import type { OnboardingStateRepository } from './OnboardingStateRepository'

function fixture() {
  let raw: string | undefined
  let completed = false
  let runId = ''
  let failTranscriptWrites = 0
  const messages: Array<{ nonce?: string; content: string }> = []
  const repository: OnboardingStateRepository = {
    async get() { return { hasSeenOnboarding: completed, onboardingSession: raw } },
    async compareAndSet({ expectedRevision, expectedRunId, onboardingSession, hasSeenOnboarding }) {
      const current = raw ? (JSON.parse(raw) as { session: OnboardingSession }).session : null
      const revision = current?.revision ?? 0
      if (revision !== expectedRevision || current?.runId !== expectedRunId) return { ok: false, reason: 'stale_revision', currentRevision: revision, currentRunId: current?.runId }
      raw = onboardingSession
      completed = hasSeenOnboarding
      return { ok: true, revision: expectedRevision + 1 }
    },
    async clearOutbox({ expectedRevision, expectedRunId, onboardingSession }) {
      const current = raw ? (JSON.parse(raw) as { session: OnboardingSession }).session : null
      if (!current || current.revision !== expectedRevision || current.runId !== expectedRunId) return false
      raw = onboardingSession
      return true
    },
    async reset() {
      raw = undefined
      completed = false
      return true
    },
  }
  const effects: OnboardingEffects = {
    agents: {
      async list() {
        return {
          agents: [{
            id: 'overlay',
            principalId: 'overlay-principal',
            name: 'Overlay',
            isDefault: true,
            visibility: 'workspace',
            createdByPrincipalId: 'owner',
          }],
          viewerPrincipalId: 'owner',
        } as never
      },
      async resolveMainThread() {
        return { conversationId: 'conversation-1', title: 'Overlay' }
      },
    },
    collaboration: {
      async addMessage(args) {
        if (failTranscriptWrites > 0) { failTranscriptWrites -= 1; throw new Error('transcript unavailable') }
        messages.push({ nonce: args.clientNonce, content: args.content })
        return `message-${messages.length}`
      },
      async addAgentMessage(args) {
        if (failTranscriptWrites > 0) { failTranscriptWrites -= 1; throw new Error('transcript unavailable') }
        messages.push({ nonce: args.clientNonce, content: args.content })
        return `message-${messages.length}`
      },
    },
    memories: { async get() { return null } },
    workspaces: { async listInvitations() { return [] } },
    work: { async get() { throw new WorkServiceError('Task not found.', 404, 'work_not_found') } },
  }
  return {
    repository, effects, messages, service: new ConversationalOnboardingService({ repository, effects }),
    get runId() { return runId }, set runId(value: string) { runId = value },
    get failTranscriptWrites() { return failTranscriptWrites }, set failTranscriptWrites(value: number) { failTranscriptWrites = value },
  }
}

async function start(fixtureValue: ReturnType<typeof fixture>) {
  const result = await fixtureValue.service.start('user-1', 'workspace-1')
  fixtureValue.runId = result.session?.runId ?? ''
  return result
}

type ActionInput<T = Exclude<OnboardingAction, { action: 'start' }>> = T extends { runId: string } ? Omit<T, 'runId'> & { runId?: string } : never
function act(fixtureValue: ReturnType<typeof fixture>, action: ActionInput, userId = 'user-1') {
  return fixtureValue.service.act(userId, 'workspace-1', { ...action, runId: action.runId ?? fixtureValue.runId } as OnboardingAction)
}

test('actions require a strict run id except for start', () => {
  assert.equal(OnboardingActionSchema.safeParse({ action: 'start' }).success, true)
  assert.equal(OnboardingActionSchema.safeParse({ action: 'answer', revision: 1, value: 'Ada' }).success, false)
  assert.equal(OnboardingActionSchema.safeParse({
    action: 'answer', runId: 'invalid', revision: 1, value: 'Ada',
  }).success, false)
  assert.equal(OnboardingActionSchema.safeParse({
    action: 'answer', runId: '11111111-1111-4111-8111-111111111111', revision: 1, value: 'Ada', extra: true,
  }).success, false)
})

async function advanceToTask(fixtureValue: ReturnType<typeof fixture>) {
  await start(fixtureValue)
  await act(fixtureValue, { action: 'answer', revision: 1, value: 'Ada' })
  await act(fixtureValue, { action: 'answer', revision: 2, value: 'Builds software' })
  await act(fixtureValue, { action: 'answer', revision: 3, value: 'Planning and coding' })
  await act(fixtureValue, { action: 'advance', revision: 4 })
  await act(fixtureValue, { action: 'advance', revision: 5 })
  await act(fixtureValue, { action: 'advance', revision: 6 })
  return await act(fixtureValue, { action: 'advance', revision: 7 })
}

test('normal onboarding actions advance the approved sequence', async () => {
  const f = fixture()
  let response = await start(f)
  assert.equal(response.session?.step, 'name')
  response = await act(f, { action: 'answer', revision: 1, value: 'Ada' })
  assert.equal(response.session?.step, 'about')
  response = await act(f, { action: 'answer', revision: 2, value: 'Builds software' })
  assert.equal(response.session?.step, 'daily')
  response = await act(f, { action: 'answer', revision: 3, value: 'Planning and coding' })
  assert.equal(response.session?.step, 'employees')
  response = await act(f, { action: 'advance', revision: 4 })
  assert.equal(response.session?.step, 'connections')
  assert.equal(response.session?.aiEnabled, false)
  assert.equal(f.messages.at(-2)?.content, 'Skipped selecting AI employees.')
})

test('advance records only validated choice counts before each assistant reply', async () => {
  const f = fixture()
  f.effects.memories.get = async ({ memoryId }) => ({ id: memoryId, userId: 'user-1', visibility: 'personal' } as never)
  f.effects.workspaces.listInvitations = async () => [{ id: 'invitation-1', status: 'pending' }] as never
  await start(f)
  await act(f, { action: 'answer', revision: 1, value: 'Ada' })
  await act(f, { action: 'answer', revision: 2, value: 'Builds software' })
  await act(f, { action: 'answer', revision: 3, value: 'Planning and coding' })
  await act(f, { action: 'advance', revision: 4, agentIds: ['overlay'] })
  assert.equal(f.messages.at(-2)?.content, 'Selected 1 AI employee.')
  await act(f, { action: 'advance', revision: 5 })
  assert.equal(f.messages.at(-2)?.content, 'Skipped connecting tools.')
  await act(f, { action: 'advance', revision: 6, memoryIds: ['memory-1'] })
  assert.equal(f.messages.at(-2)?.content, 'Imported 1 Personal context item.')
  await act(f, { action: 'advance', revision: 7, invitationIds: ['invitation-1'] })
  assert.equal(f.messages.at(-2)?.content, 'Invited 1 teammate.')
})

test('stale retries recover the exact transcript once', async () => {
  const f = fixture()
  await start(f)
  await act(f, { action: 'answer', revision: 1, value: 'Ada' })
  const count = f.messages.length
  const retry = await act(f, { action: 'answer', revision: 1, value: 'Ada' })
  assert.equal(retry.session?.revision, 2)
  assert.equal(f.messages.length, count)
  assert.deepEqual(f.messages.map((message) => message.content), [
    "I'm Overlay, your new chief of staff. I'm responsible for getting your work done and managing your fleet of AI employees to help you achieve your goals.\n\nWhat shall I call you?",
    'Ada',
    'Nice to meet you, Ada. Tell me a bit about yourself. What do you do, and what are you working on?',
  ])
})

test('reset isolates run ids, transcript nonces, stale actions, and CAS clearing', async () => {
  const f = fixture()
  await start(f)
  const oldRunId = f.runId
  const oldNonce = f.messages[0].nonce
  await f.service.reset('user-1')
  await start(f)
  assert.notEqual(f.runId, oldRunId)
  assert.notEqual(f.messages.at(-1)?.nonce, oldNonce)
  const stale = await act(f, { action: 'answer', runId: oldRunId, revision: 1, value: 'stale' })
  assert.equal(stale.session?.step, 'name')
  assert.equal(f.messages.at(-1)?.content, "I'm Overlay, your new chief of staff. I'm responsible for getting your work done and managing your fleet of AI employees to help you achieve your goals.\n\nWhat shall I call you?")
  const current = JSON.parse((await f.repository.get('user-1'))?.onboardingSession ?? '{}') as { session: OnboardingSession }
  assert.equal((await f.repository.compareAndSet({
    userId: 'user-1', expectedRevision: 1, expectedRunId: oldRunId,
    onboardingSession: JSON.stringify(current), hasSeenOnboarding: false,
  })).ok, false)
  assert.equal(await f.repository.clearOutbox({
    userId: 'user-1', expectedRevision: 1, expectedRunId: oldRunId,
    onboardingSession: JSON.stringify(current),
  }), false)
})

test('workspace mismatch is rejected without leaking the session', async () => {
  const f = fixture()
  await start(f)
  await assert.rejects(
    () => f.service.get('user-1', 'workspace-2'),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'workspace_mismatch',
  )
})

test('another user cannot read or rebind an onboarding session', async () => {
  const f = fixture()
  await start(f)
  assert.deepEqual(await f.service.get('user-2', 'workspace-1'), { completed: false, session: null })
  await assert.rejects(
    () => act(f, { action: 'answer', revision: 1, value: 'Ada' }, 'user-2'),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'session_not_started',
  )
})

test('agent selections must be visible and owned by the authenticated user', async () => {
  const f = fixture()
  await start(f)
  await act(f, { action: 'answer', revision: 1, value: 'Ada' })
  await act(f, { action: 'answer', revision: 2, value: 'Builds software' })
  await act(f, { action: 'answer', revision: 3, value: 'Planning and coding' })
  const list = f.effects.agents.list
  f.effects.agents.list = async (args) => {
    const result = await list(args)
    return {
      ...result,
      agents: [...result.agents, {
        id: 'agent-foreign',
        principalId: 'foreign-principal',
        name: 'Shared agent',
        isDefault: false,
        visibility: 'workspace',
        createdByPrincipalId: 'other-user',
      }],
    } as never
  }
  await assert.rejects(
    () => act(f, { action: 'advance', revision: 4, agentIds: ['agent-foreign'] }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'agent_forbidden',
  )
})

test('memory and invitation selections require owned memories and listed invitations', async () => {
  const f = fixture()
  await start(f)
  await act(f, { action: 'answer', revision: 1, value: 'Ada' })
  await act(f, { action: 'answer', revision: 2, value: 'Builds software' })
  await act(f, { action: 'answer', revision: 3, value: 'Planning and coding' })
  await act(f, { action: 'advance', revision: 4 })
  await act(f, { action: 'advance', revision: 5 })
  f.effects.memories.get = async () => ({ userId: 'user-2', visibility: 'personal' } as never)
  await assert.rejects(
    () => act(f, { action: 'advance', revision: 6, memoryIds: ['foreign-memory'] }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'memory_forbidden',
  )
  await act(f, { action: 'advance', revision: 6 })
  await assert.rejects(
    () => act(f, { action: 'advance', revision: 7, invitationIds: ['foreign-invitation'] }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'invitation_forbidden',
  )
})

test('consent updates do not add a transcript turn', async () => {
  const f = fixture()
  await start(f)
  const count = f.messages.length
  const result = await act(f, { action: 'consent', revision: 1, enabled: true })
  assert.equal(result.session?.aiEnabled, true)
  assert.equal(f.messages.length, count)
})

test('missing and foreign tasks cannot falsely complete onboarding', async () => {
  const f = fixture()
  await advanceToTask(f)
  await assert.rejects(
    () => act(f, { action: 'finish', revision: 8, taskId: 'missing' }),
  )
  f.effects.work.get = async () => ({
    id: 'task-foreign',
    workspaceId: 'workspace-1',
    createdBy: 'user-2',
  } as never)
  await assert.rejects(
    () => act(f, { action: 'finish', revision: 8, taskId: 'task-foreign' }),
  )
  assert.equal((await f.service.get('user-1', 'workspace-1')).completed, false)
})

test('a verified first task completes onboarding durably', async () => {
  const f = fixture()
  await advanceToTask(f)
  f.effects.work.get = async () => ({
    id: 'task-1',
    title: 'Review the launch plan',
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
  } as never)
  const result = await act(f, { action: 'finish', revision: 8, taskId: 'task-1' })
  assert.equal(result.completed, true)
  assert.equal(result.session?.step, 'complete')
  assert.equal(result.session?.taskId, 'task-1')
  const messageCount = f.messages.length
  const retry = await act(f, { action: 'finish', revision: 8, taskId: 'task-1' })
  assert.deepEqual(retry, result)
  assert.equal(f.messages.length, messageCount)
  assert.equal((await f.service.get('user-1', 'workspace-1')).completed, true)
  assert.equal(f.messages.at(-1)?.content, 'Your first task is ready in Work. Happy working.')
})

test('GET recovers a completed final transcript outbox after a write failure', async () => {
  const f = fixture()
  await advanceToTask(f)
  f.effects.work.get = async () => ({
    id: 'task-1', title: 'Review the launch plan', workspaceId: 'workspace-1', createdBy: 'user-1',
  } as never)
  f.failTranscriptWrites = 1
  await assert.rejects(() => act(f, { action: 'finish', revision: 8, taskId: 'task-1' }))
  f.failTranscriptWrites = 0
  assert.deepEqual(await f.service.get('user-1', 'workspace-2'), { completed: true, session: null })
  const result = await f.service.get('user-1', 'workspace-1')
  assert.equal(result.completed, true)
  assert.deepEqual(f.messages.slice(-2).map((message) => message.content), [
    'Review the launch plan',
    'Your first task is ready in Work. Happy working.',
  ])
})
