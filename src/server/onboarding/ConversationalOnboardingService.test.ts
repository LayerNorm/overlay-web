import { strict as assert } from 'node:assert'
import test from 'node:test'
import { WorkServiceError } from '@/server/work/WorkService'
import type { OnboardingSession } from '@/shared/onboarding/session'
import { ConversationalOnboardingService, type OnboardingEffects } from './ConversationalOnboardingService'
import type { OnboardingStateRepository } from './OnboardingStateRepository'

function fixture() {
  let raw: string | undefined
  let completed = false
  const messages: Array<{ nonce?: string; content: string }> = []
  const repository: OnboardingStateRepository = {
    async get() { return { hasSeenOnboarding: completed, onboardingSession: raw } },
    async compareAndSet({ expectedRevision, onboardingSession, hasSeenOnboarding }) {
      const revision = raw ? (JSON.parse(raw) as { session: OnboardingSession }).session.revision : 0
      if (revision !== expectedRevision) return { ok: false, reason: 'stale_revision', currentRevision: revision }
      raw = onboardingSession
      completed = hasSeenOnboarding
      return { ok: true, revision: expectedRevision + 1 }
    },
    async clearOutbox({ onboardingSession }) {
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
        messages.push({ nonce: args.clientNonce, content: args.content })
        return `message-${messages.length}`
      },
      async addAgentMessage(args) {
        messages.push({ nonce: args.clientNonce, content: args.content })
        return `message-${messages.length}`
      },
    },
    memories: { async get() { return null } },
    workspaces: { async listInvitations() { return [] } },
    work: { async get() { throw new WorkServiceError('Task not found.', 404, 'work_not_found') } },
  }
  return { repository, effects, messages, service: new ConversationalOnboardingService({ repository, effects }) }
}

async function start(fixtureValue: ReturnType<typeof fixture>) {
  return await fixtureValue.service.start('user-1', 'workspace-1')
}

async function advanceToTask(fixtureValue: ReturnType<typeof fixture>) {
  await start(fixtureValue)
  await fixtureValue.service.act('user-1', 'workspace-1', { action: 'answer', revision: 1, value: 'Ada' })
  await fixtureValue.service.act('user-1', 'workspace-1', { action: 'answer', revision: 2, value: 'Builds software' })
  await fixtureValue.service.act('user-1', 'workspace-1', { action: 'answer', revision: 3, value: 'Planning and coding' })
  await fixtureValue.service.act('user-1', 'workspace-1', { action: 'advance', revision: 4 })
  await fixtureValue.service.act('user-1', 'workspace-1', { action: 'advance', revision: 5 })
  await fixtureValue.service.act('user-1', 'workspace-1', { action: 'advance', revision: 6 })
  return await fixtureValue.service.act('user-1', 'workspace-1', { action: 'advance', revision: 7 })
}

test('normal onboarding actions advance the approved sequence', async () => {
  const f = fixture()
  let response = await start(f)
  assert.equal(response.session?.step, 'name')
  response = await f.service.act('user-1', 'workspace-1', { action: 'answer', revision: 1, value: 'Ada' })
  assert.equal(response.session?.step, 'about')
  response = await f.service.act('user-1', 'workspace-1', { action: 'answer', revision: 2, value: 'Builds software' })
  assert.equal(response.session?.step, 'daily')
  response = await f.service.act('user-1', 'workspace-1', { action: 'answer', revision: 3, value: 'Planning and coding' })
  assert.equal(response.session?.step, 'employees')
  response = await f.service.act('user-1', 'workspace-1', { action: 'advance', revision: 4 })
  assert.equal(response.session?.step, 'connections')
  assert.equal(response.session?.aiEnabled, false)
})

test('stale retries recover the exact transcript once', async () => {
  const f = fixture()
  await start(f)
  await f.service.act('user-1', 'workspace-1', { action: 'answer', revision: 1, value: 'Ada' })
  const count = f.messages.length
  const retry = await f.service.act('user-1', 'workspace-1', { action: 'answer', revision: 1, value: 'Ada' })
  assert.equal(retry.session?.revision, 2)
  assert.equal(f.messages.length, count)
  assert.deepEqual(f.messages.map((message) => message.content), [
    "I'm Overlay, your new chief of staff. I'm responsible for getting your work done and managing your fleet of AI employees to help you achieve your goals.\n\nWhat shall I call you?",
    'Ada',
    'Nice to meet you, Ada. Tell me a bit about yourself. What do you do, and what are you working on?',
  ])
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
    () => f.service.act('user-2', 'workspace-1', { action: 'answer', revision: 1, value: 'Ada' }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'session_not_started',
  )
})

test('agent selections must be visible and owned by the authenticated user', async () => {
  const f = fixture()
  await start(f)
  await f.service.act('user-1', 'workspace-1', { action: 'answer', revision: 1, value: 'Ada' })
  await f.service.act('user-1', 'workspace-1', { action: 'answer', revision: 2, value: 'Builds software' })
  await f.service.act('user-1', 'workspace-1', { action: 'answer', revision: 3, value: 'Planning and coding' })
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
    () => f.service.act('user-1', 'workspace-1', { action: 'advance', revision: 4, agentIds: ['agent-foreign'] }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'agent_forbidden',
  )
})

test('memory and invitation selections require owned memories and listed invitations', async () => {
  const f = fixture()
  await start(f)
  await f.service.act('user-1', 'workspace-1', { action: 'answer', revision: 1, value: 'Ada' })
  await f.service.act('user-1', 'workspace-1', { action: 'answer', revision: 2, value: 'Builds software' })
  await f.service.act('user-1', 'workspace-1', { action: 'answer', revision: 3, value: 'Planning and coding' })
  await f.service.act('user-1', 'workspace-1', { action: 'advance', revision: 4 })
  await f.service.act('user-1', 'workspace-1', { action: 'advance', revision: 5 })
  f.effects.memories.get = async () => ({ userId: 'user-2', visibility: 'personal' } as never)
  await assert.rejects(
    () => f.service.act('user-1', 'workspace-1', { action: 'advance', revision: 6, memoryIds: ['foreign-memory'] }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'memory_forbidden',
  )
  await f.service.act('user-1', 'workspace-1', { action: 'advance', revision: 6 })
  await assert.rejects(
    () => f.service.act('user-1', 'workspace-1', { action: 'advance', revision: 7, invitationIds: ['foreign-invitation'] }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'invitation_forbidden',
  )
})

test('consent updates do not add a transcript turn', async () => {
  const f = fixture()
  await start(f)
  const count = f.messages.length
  const result = await f.service.act('user-1', 'workspace-1', { action: 'consent', revision: 1, enabled: true })
  assert.equal(result.session?.aiEnabled, true)
  assert.equal(f.messages.length, count)
})

test('missing and foreign tasks cannot falsely complete onboarding', async () => {
  const f = fixture()
  await advanceToTask(f)
  await assert.rejects(
    () => f.service.act('user-1', 'workspace-1', { action: 'finish', revision: 8, taskId: 'missing' }),
  )
  f.effects.work.get = async () => ({
    id: 'task-foreign',
    workspaceId: 'workspace-1',
    createdBy: 'user-2',
  } as never)
  await assert.rejects(
    () => f.service.act('user-1', 'workspace-1', { action: 'finish', revision: 8, taskId: 'task-foreign' }),
  )
  assert.equal((await f.service.get('user-1', 'workspace-1')).completed, false)
})

test('a verified first task completes onboarding durably', async () => {
  const f = fixture()
  await advanceToTask(f)
  f.effects.work.get = async () => ({
    id: 'task-1',
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
  } as never)
  const result = await f.service.act('user-1', 'workspace-1', { action: 'finish', revision: 8, taskId: 'task-1' })
  assert.equal(result.completed, true)
  assert.equal(result.session?.step, 'complete')
  assert.equal(result.session?.taskId, 'task-1')
  const messageCount = f.messages.length
  const retry = await f.service.act('user-1', 'workspace-1', { action: 'finish', revision: 8, taskId: 'task-1' })
  assert.deepEqual(retry, result)
  assert.equal(f.messages.length, messageCount)
  assert.equal((await f.service.get('user-1', 'workspace-1')).completed, true)
  assert.equal(f.messages.at(-1)?.content, 'Your first task is ready in Work. Happy working.')
})
