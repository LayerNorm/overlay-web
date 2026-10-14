import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkItem } from '@overlay/app-core'
import { WorkService, WorkServiceError, translateWorkError } from './WorkService'
import type { WorkRepository } from './WorkRepository'

const actor = { userId: 'u1', workspaceId: 'w1' }
const item = { id: 'i1', title: 'Task' } as WorkItem

function repository(overrides: Partial<WorkRepository> = {}): WorkRepository {
  return {
    list: async () => [item],
    get: async () => item,
    context: async () => ({ principalId: 'p1', role: 'member', canCreateInWorkspace: true, people: [] }),
    create: async () => item,
    update: async () => item,
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
