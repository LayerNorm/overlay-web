import assert from 'node:assert/strict'
import test from 'node:test'
import { ConvexError } from 'convex/values'
import type { WorkItem } from '@overlay/app-core'
import { WorkService, WorkServiceError, translateWorkError } from './WorkService'
import type { WorkRepository } from './WorkRepository'

const actor = { userId: 'u1', workspaceId: 'w1' }
const item = { id: 'i1', title: 'Task', status: 'todo', doneWhen: [], context: [], blockedBy: [] } as WorkItem

function repository(overrides: Partial<WorkRepository> = {}): WorkRepository {
  return {
    list: async () => [item],
    get: async () => item,
    context: async () => ({ principalId: 'p1', role: 'member', canCreateInWorkspace: true, people: [] }),
    create: async () => item,
    update: async () => item,
    prepareAssignment: async () => null,
    completeAssignment: async () => true,
    move: async () => item,
    listEvents: async () => [],
    addComment: async () => undefined,
    remove: async () => ({ ok: true }),
    ...overrides,
  }
}

test('refusals from Convex become plain messages with a status', () => {
  const invalid = translateWorkError(new Error('[Request ID: x] Server Error\nUncaught Error: WORK_INVALID:date_order at handler'))
  assert.ok(invalid instanceof WorkServiceError)
  assert.equal(invalid.statusCode, 400)
  assert.equal(invalid.code, 'work_date_order')
  assert.match(invalid.message, /start date/)

  const archived = translateWorkError(new Error('WORK_INVALID:archived'))
  assert.equal((archived as WorkServiceError).statusCode, 409)

  const forbidden = translateWorkError(new Error('Uncaught Error: Unauthorized'))
  assert.equal((forbidden as WorkServiceError).statusCode, 403)

  const restricted = translateWorkError(new Error('RESOURCE_SCOPE_FORBIDDEN:workspace_creation_restricted'))
  assert.equal((restricted as WorkServiceError).code, 'resource_scope_forbidden')

  const other = new Error('network down')
  assert.equal(translateWorkError(other), other)
})

test('an agent assignment is prepared and dispatched once; same-assignee edits do not duplicate it', async () => {
  const agentItem = {
    ...item,
    id: 'task-1',
    title: 'Write a plan',
    assigneePrincipalId: 'agent-1',
    updatedAt: 42,
    assignmentExecution: { assignedByUserId: 'u1', assigneePrincipalId: 'agent-1', generation: 42, status: 'pending' as const },
  } as WorkItem
  let state: 'starting' | 'started' | 'failed' = 'starting'
  let dispatches = 0
  const repo = repository({
    context: async () => ({
      principalId: 'person-1',
      role: 'member',
      canCreateInWorkspace: true,
      people: [{ principalId: 'agent-1', type: 'agent', displayName: 'Agent', userId: null }],
    }),
    create: async () => agentItem,
    update: async () => agentItem,
    prepareAssignment: async () => ({
      execution: {
        assignedByUserId: 'u1',
        assigneePrincipalId: 'agent-1',
        generation: 42,
        status: state,
        conversationId: 'conversation-1',
        messageId: 'message-1',
        turnId: 'turn-1',
      },
      claimed: state === 'starting',
    }),
    completeAssignment: async (args) => {
      state = args.status
      return true
    },
  })
  const service = new WorkService(repo, async () => { dispatches += 1; return [] })

  const created = await service.create({ ...actor, input: { title: 'Write a plan', assigneePrincipalId: 'agent-1' } })
  assert.equal(dispatches, 1)
  assert.equal(state, 'started')
  assert.equal(created.assignmentExecution?.status, 'started')

  await service.update({ ...actor, id: 'task-1', input: { assigneePrincipalId: 'agent-1' } })
  assert.equal(dispatches, 1)
})

test('agent launch failures are persisted and reported with the saved task id', async () => {
  const agentItem = {
    ...item,
    id: 'task-2',
    assigneePrincipalId: 'agent-1',
    updatedAt: 43,
    assignmentExecution: { assignedByUserId: 'u1', assigneePrincipalId: 'agent-1', generation: 43, status: 'pending' as const },
  } as WorkItem
  let state: 'starting' | 'failed' = 'starting'
  let storedError = ''
  const repo = repository({
    context: async () => ({
      principalId: 'person-1',
      role: 'member',
      canCreateInWorkspace: true,
      people: [{ principalId: 'agent-1', type: 'agent', displayName: 'Agent', userId: null }],
    }),
    create: async () => agentItem,
    prepareAssignment: async () => ({
      execution: {
        assignedByUserId: 'u1',
        assigneePrincipalId: 'agent-1',
        generation: 43,
        status: state,
        conversationId: 'conversation-2',
        messageId: 'message-2',
        turnId: 'turn-2',
      },
      claimed: state === 'starting',
    }),
    completeAssignment: async (args) => {
      state = 'failed'
      storedError = args.error ?? ''
      return true
    },
  })
  const service = new WorkService(repo, async () => { throw new Error('provider unavailable') })
  await assert.rejects(
    service.create({ ...actor, input: { title: 'Task', assigneePrincipalId: 'agent-1' } }),
    (error: unknown) => error instanceof WorkServiceError
      && error.statusCode === 502
      && /task-2/.test(error.message)
      && /provider unavailable/.test(error.message),
  )
  assert.equal(state, 'failed')
  assert.match(storedError, /task-2/)
})

test('an assignment already starting is reported as in progress', async () => {
  const agentItem = {
    ...item,
    id: 'task-3',
    assigneePrincipalId: 'agent-1',
    assignmentExecution: { assignedByUserId: 'u1', assigneePrincipalId: 'agent-1', generation: 44, status: 'pending' as const },
  } as WorkItem
  const service = new WorkService(repository({
    context: async () => ({
      principalId: 'person-1',
      role: 'member',
      canCreateInWorkspace: true,
      people: [{ principalId: 'agent-1', type: 'agent', displayName: 'Agent', userId: null }],
    }),
    update: async () => agentItem,
    prepareAssignment: async () => ({
      execution: {
        assignedByUserId: 'u1',
        assigneePrincipalId: 'agent-1',
        generation: 44,
        status: 'starting',
      },
      claimed: false,
    }),
  }), async () => {
    throw new Error('A concurrent start should not dispatch again')
  })

  await assert.rejects(
    service.update({ ...actor, id: 'task-3', input: { assigneePrincipalId: 'agent-1' } }),
    (error: unknown) => error instanceof WorkServiceError
      && error.statusCode === 409
      && error.code === 'work_assignment_in_progress',
  )
})

test('an unconfirmed agent start is not marked failed or offered for retry', async () => {
  const agentItem = {
    ...item,
    id: 'task-4',
    assigneePrincipalId: 'agent-1',
    assignmentExecution: { assignedByUserId: 'u1', assigneePrincipalId: 'agent-1', generation: 45, status: 'pending' as const },
  } as WorkItem
  const completionStatuses: string[] = []
  const service = new WorkService(repository({
    context: async () => ({
      principalId: 'person-1',
      role: 'member',
      canCreateInWorkspace: true,
      people: [{ principalId: 'agent-1', type: 'agent', displayName: 'Agent', userId: null }],
    }),
    create: async () => agentItem,
    prepareAssignment: async () => ({
      execution: {
        assignedByUserId: 'u1',
        assigneePrincipalId: 'agent-1',
        generation: 45,
        status: 'starting',
        conversationId: 'conversation-4',
        messageId: 'message-4',
        turnId: 'turn-4',
      },
      claimed: true,
    }),
    completeAssignment: async ({ status }) => {
      completionStatuses.push(status)
      if (status === 'started') throw new Error('confirmation unavailable')
      return true
    },
  }), async () => [])

  await assert.rejects(
    service.create({ ...actor, input: { title: 'Task', assigneePrincipalId: 'agent-1' } }),
    (error: unknown) => error instanceof WorkServiceError
      && error.statusCode === 503
      && error.code === 'work_assignment_unconfirmed'
      && /Do not clear or reassign/.test(error.message),
  )
  assert.deepEqual(completionStatuses, ['started'])
})

test('a production-redacted revision conflict remains an HTTP 409', () => {
  const error = new ConvexError('WORK_INVALID:conflict')
  error.message = '[Request ID: example] Server Error'
  const translated = translateWorkError(error)
  assert.ok(translated instanceof WorkServiceError)
  assert.equal(translated.statusCode, 409)
  assert.equal(translated.code, 'work_conflict')
})

test('a missing task is a 404 and a caller without access to the workspace is refused', async () => {
  const service = new WorkService(repository({ get: async () => null, context: async () => null }))
  await assert.rejects(service.get({ ...actor, id: 'x' }), (error: unknown) => error instanceof WorkServiceError && error.statusCode === 404)
  await assert.rejects(service.context(actor), (error: unknown) => error instanceof WorkServiceError && error.statusCode === 403)
  await assert.rejects(service.listEvents({ ...actor, id: 'x' }), (error: unknown) => error instanceof WorkServiceError && error.statusCode === 404)
})

test('repository errors are translated on every write', async () => {
  const boom = async () => { throw new Error('WORK_INVALID:title_required') }
  const service = new WorkService(repository({ create: boom, update: boom, move: boom, addComment: boom }))
  const refused = (error: unknown) => error instanceof WorkServiceError && error.statusCode === 400
  await assert.rejects(service.create({ ...actor, input: { title: '' } }), refused)
  await assert.rejects(service.update({ ...actor, id: 'i', input: {} }), refused)
  await assert.rejects(service.move({ ...actor, id: 'i', input: {} }), refused)
  await assert.rejects(service.addComment({ ...actor, id: 'i', body: '' }), refused)
})

test('reads pass through', async () => {
  const service = new WorkService(repository())
  assert.deepEqual(await service.list({ ...actor, view: 'workspace' }), [item])
  assert.deepEqual(await service.get({ ...actor, id: 'i1' }), item)
  assert.deepEqual(await service.listEvents({ ...actor, id: 'i1' }), [])
})

test('deleting reports why it was refused', async () => {
  const outcome = (reason: 'not_found' | 'not_archived' | 'forbidden') => new WorkService(repository({ remove: async () => ({ ok: false, reason }) }))
  await assert.doesNotReject(new WorkService(repository()).remove({ ...actor, id: 'i' }))
  await assert.rejects(outcome('not_found').remove({ ...actor, id: 'i' }), (e: unknown) => e instanceof WorkServiceError && e.statusCode === 404)
  await assert.rejects(outcome('not_archived').remove({ ...actor, id: 'i' }), (e: unknown) => e instanceof WorkServiceError && e.statusCode === 409 && /Archive the task/.test(e.message))
  await assert.rejects(outcome('forbidden').remove({ ...actor, id: 'i' }), (e: unknown) => e instanceof WorkServiceError && e.statusCode === 403)
})
