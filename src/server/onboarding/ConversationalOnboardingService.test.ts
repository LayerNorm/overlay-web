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

async function currentSession(fixtureValue: ReturnType<typeof fixture>) {
  const session = (await fixtureValue.service.get('user-1', 'workspace-1')).session
  assert.ok(session)
  return session
}

async function answerCurrent(fixtureValue: ReturnType<typeof fixture>, value: string) {
  return await act(fixtureValue, {
    action: 'answer',
    revision: (await currentSession(fixtureValue)).revision,
    value,
  })
}

async function advanceCurrent(
  fixtureValue: ReturnType<typeof fixture>,
  options: Partial<Pick<Extract<OnboardingAction, { action: 'advance' }>, 'agentIds' | 'memoryIds' | 'invitationIds' | 'connectedTools'>> = {},
) {
  return await act(fixtureValue, {
    action: 'advance',
    revision: (await currentSession(fixtureValue)).revision,
    ...options,
  })
}

async function answerOwnerProfile(fixtureValue: ReturnType<typeof fixture>) {
  await start(fixtureValue)
  await answerCurrent(fixtureValue, 'Ada')
  await answerCurrent(fixtureValue, 'Builds software')
  await answerCurrent(fixtureValue, 'A small team')
  return await answerCurrent(fixtureValue, 'Planning & coordination, Coding & reviews')
}

test('workspace-first questions resume with corrections and skip solo invitations', async () => {
  const f = fixture()
  let result = await start(f)
  assert.equal(result.session?.flowVersion, 3)
  const answer = async (value: string) => {
    result = await act(f, { action: 'answer', revision: result.session!.revision, value })
  }
  await answer('You can call me ada.')
  assert.equal(result.session?.profile.name, 'Ada')
  assert.equal(f.messages.at(-2)?.content, 'You can call me ada.')
  assert.equal(f.messages.at(-1)?.content, 'Nice to meet you, Ada.\n\nWhat kind of work do you do?')
  await answer('Engineering')
  assert.equal(result.session?.step, 'team')
  await answer('Just me')
  assert.equal(result.session?.step, 'daily')
  result = await act(f, { action: 'back', revision: result.session!.revision })
  assert.equal(result.session?.step, 'team')
  assert.equal(result.session?.profile.team, 'Just me')
  const staleRevision = result.session!.revision - 1
  assert.equal((await act(f, { action: 'answer', revision: staleRevision, value: 'A larger company' })).session?.profile.team, 'Just me')
  await answer('Just me')
  await answer('Research & summaries, with my own custom requirements')
  assert.equal(result.session?.profile.daily, 'Research & summaries, with my own custom requirements')
  assert.equal((await f.service.get('user-1', 'workspace-1')).session?.step, 'employees')
  assert.deepEqual(result.session?.employees.map((employee) => employee.name), ['Scout', 'Spec'])
  for (const step of ['connections', 'memories', 'task']) {
    result = await act(f, { action: 'advance', revision: result.session!.revision })
    assert.equal(result.session?.step, step)
  }
})

test('names are read out of conversational answers', async () => {
  const f = fixture()
  await start(f)
  await assert.rejects(
    () => answerCurrent(f, '...'),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'invalid_profile',
  )
  const result = await answerCurrent(f, "Hi! I'm Divyansh")
  assert.equal(result.session?.profile.name, 'Divyansh')
})

test('provider connections remain in onboarding independently of app and agent capabilities', async () => {
  const f = fixture()
  const service = new ConversationalOnboardingService({ repository: f.repository, effects: f.effects })
  let result = await service.start('user-1', 'workspace-1')
  for (const value of ['Ada', 'Design', 'A small team', 'Writing & content']) {
    result = await service.act('user-1', 'workspace-1', { action: 'answer', runId: result.session!.runId, revision: result.session!.revision, value })
  }
  result = await service.act('user-1', 'workspace-1', { action: 'advance', runId: result.session!.runId, revision: result.session!.revision })
  assert.equal(result.session?.step, 'connections')
  result = await service.act('user-1', 'workspace-1', { action: 'advance', runId: result.session!.runId, revision: result.session!.revision })
  assert.equal(result.session?.step, 'memories')
})

test('back remains within profile questions for owners and members', async () => {
  const owner = fixture()
  await answerOwnerProfile(owner)
  const ownerSession = await currentSession(owner)
  assert.equal(ownerSession.step, 'employees')
  await assert.rejects(
    () => act(owner, { action: 'back', revision: ownerSession.revision }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'invalid_step',
  )

  const member = fixture()
  const result = await member.service.start('user-1', 'workspace-1', { member: true })
  member.runId = result.session!.runId
  await answerCurrent(member, 'Ada')
  await answerCurrent(member, 'Design')
  await answerCurrent(member, 'Research & summaries')
  const memberSession = await currentSession(member)
  assert.equal(memberSession.step, 'connections')
  await assert.rejects(
    () => act(member, { action: 'back', revision: memberSession.revision }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'invalid_step',
  )
})

test('invited members get personal setup, not workspace-owner questions', async () => {
  const f = fixture()
  let result = await f.service.start('user-1', 'workspace-1', { member: true })
  f.runId = result.session!.runId
  for (const value of ['Ada', 'Design', 'Research & summaries']) result = await act(f, { action: 'answer', revision: result.session!.revision, value })
  assert.equal(result.session?.step, 'connections')
  assert.equal(result.session?.member, true)
  for (const step of ['memories', 'task']) {
    result = await act(f, { action: 'advance', revision: result.session!.revision })
    assert.equal(result.session?.step, step)
  }
})

test('legacy saved sessions continue their original questions without restarting', async () => {
  const f = fixture()
  const first = await start(f)
  const record = await f.repository.get('user-1')
  const stored = JSON.parse(record!.onboardingSession!)
  delete stored.session.flowVersion
  delete stored.session.member
  await f.repository.compareAndSet({ userId: 'user-1', expectedRevision: first.session!.revision, expectedRunId: first.session!.runId, onboardingSession: JSON.stringify(stored), hasSeenOnboarding: false })
  await act(f, { action: 'answer', revision: 1, value: 'Ada' })
  const result = await act(f, { action: 'answer', revision: 2, value: 'Engineering' })
  assert.equal(result.session?.step, 'daily')
  assert.equal(result.session?.runId, first.session?.runId)
})

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
  await answerOwnerProfile(fixtureValue)
  await advanceCurrent(fixtureValue)
  await advanceCurrent(fixtureValue)
  await advanceCurrent(fixtureValue)
  return await advanceCurrent(fixtureValue)
}

test('normal onboarding actions advance the approved sequence', async () => {
  const f = fixture()
  let response = await start(f)
  assert.equal(response.session?.step, 'name')
  response = await answerCurrent(f, 'Ada')
  assert.equal(response.session?.step, 'about')
  response = await answerCurrent(f, 'Builds software')
  assert.equal(response.session?.step, 'team')
  response = await answerCurrent(f, 'A small team')
  assert.equal(response.session?.step, 'daily')
  response = await answerCurrent(f, 'Planning and coding')
  assert.equal(response.session?.step, 'employees')
  response = await advanceCurrent(f)
  assert.equal(response.session?.step, 'connections')
  assert.equal(response.session?.aiEnabled, false)
  assert.equal(f.messages.at(-2)?.content, "I'll set up employees later.")
})

test('advance replies read like the user said them', async () => {
  const f = fixture()
  f.effects.memories.get = async ({ memoryId }) => ({ id: memoryId, userId: 'user-1', visibility: 'personal' } as never)
  f.effects.workspaces.listInvitations = async () => [{ id: 'invitation-1', status: 'pending', email: 'sam@acme.com' }] as never
  await answerOwnerProfile(f)
  await advanceCurrent(f, { agentIds: ['overlay'] })
  assert.equal(f.messages.at(-2)?.content, 'Add Overlay.')
  assert.match(f.messages.at(-1)?.content ?? '', /^Overlay is on your team\.\n\nWant to connect/)
  await advanceCurrent(f, { connectedTools: ['gmail', 'slack'] })
  assert.equal(f.messages.at(-2)?.content, 'Connected Gmail and Slack.')
  await advanceCurrent(f, { memoryIds: ['memory-1'] })
  assert.equal(f.messages.at(-2)?.content, 'Here is some context from my other assistant.')
  await advanceCurrent(f, { invitationIds: ['invitation-1'] })
  assert.equal(f.messages.at(-2)?.content, 'Invite sam@acme.com.')
  assert.match(f.messages.at(-1)?.content ?? '', /^Invites sent\./)
})

test('tools can only be reported from the connections step', async () => {
  const f = fixture()
  await answerOwnerProfile(f)
  await assert.rejects(
    () => advanceCurrent(f, { connectedTools: ['gmail'] }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'invalid_action',
  )
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
    "Hi, I'm Overlay, your chief of staff. I'll run your AI employees and keep your work moving.\n\nWhat should I call you?",
    'Ada',
    'Nice to meet you, Ada.\n\nWhat kind of work do you do?',
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
  assert.equal(f.messages.at(-1)?.content, "Hi, I'm Overlay, your chief of staff. I'll run your AI employees and keep your work moving.\n\nWhat should I call you?")
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
  await answerOwnerProfile(f)
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
    () => advanceCurrent(f, { agentIds: ['agent-foreign'] }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'agent_forbidden',
  )
})

test('memory and invitation selections require owned memories and listed invitations', async () => {
  const f = fixture()
  await answerOwnerProfile(f)
  await advanceCurrent(f)
  await advanceCurrent(f)
  f.effects.memories.get = async () => ({ userId: 'user-2', visibility: 'personal' } as never)
  await assert.rejects(
    () => advanceCurrent(f, { memoryIds: ['foreign-memory'] }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'memory_forbidden',
  )
  await advanceCurrent(f)
  await assert.rejects(
    () => advanceCurrent(f, { invitationIds: ['foreign-invitation'] }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'invitation_forbidden',
  )
})

test('missing and foreign tasks cannot falsely complete onboarding', async () => {
  const f = fixture()
  const task = await advanceToTask(f)
  await assert.rejects(
    () => act(f, { action: 'finish', revision: task.session!.revision, taskId: 'missing' }),
  )
  f.effects.work.get = async () => ({
    id: 'task-foreign',
    workspaceId: 'workspace-1',
    createdBy: 'user-2',
  } as never)
  await assert.rejects(
    () => act(f, { action: 'finish', revision: task.session!.revision, taskId: 'task-foreign' }),
  )
  assert.equal((await f.service.get('user-1', 'workspace-1')).completed, false)
})

test('a verified first task completes onboarding durably', async () => {
  const f = fixture()
  const task = await advanceToTask(f)
  f.effects.work.get = async () => ({
    id: 'task-1',
    title: 'Review the launch plan',
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
  } as never)
  const result = await act(f, { action: 'finish', revision: task.session!.revision, taskId: 'task-1' })
  assert.equal(result.completed, true)
  assert.equal(result.session?.step, 'complete')
  assert.equal(result.session?.taskId, 'task-1')
  const messageCount = f.messages.length
  const retry = await act(f, { action: 'finish', revision: task.session!.revision, taskId: 'task-1' })
  assert.deepEqual(retry, result)
  assert.equal(f.messages.length, messageCount)
  assert.equal((await f.service.get('user-1', 'workspace-1')).completed, true)
  assert.equal(f.messages.at(-1)?.content, "You're all set. Your first task is waiting in Work.\n\nHappy working.")
})

test('GET recovers a completed final transcript outbox after a write failure', async () => {
  const f = fixture()
  const task = await advanceToTask(f)
  f.effects.work.get = async () => ({
    id: 'task-1', title: 'Review the launch plan', workspaceId: 'workspace-1', createdBy: 'user-1',
  } as never)
  f.failTranscriptWrites = 1
  await assert.rejects(() => act(f, { action: 'finish', revision: task.session!.revision, taskId: 'task-1' }))
  f.failTranscriptWrites = 0
  assert.deepEqual(await f.service.get('user-1', 'workspace-2'), { completed: true, session: null })
  const result = await f.service.get('user-1', 'workspace-1')
  assert.equal(result.completed, true)
  assert.equal(result.session?.taskId, 'task-1')
  assert.deepEqual(f.messages.slice(-2).map((message) => message.content), [
    'Review the launch plan',
    "You're all set. Your first task is waiting in Work.\n\nHappy working.",
  ])
})
