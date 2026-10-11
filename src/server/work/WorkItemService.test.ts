import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WorkItemRevisionConflictError,
  WorkItemService,
  WorkItemServiceError,
  type WorkItemDetail,
  type WorkItemRecord,
  type WorkItemRepository,
} from './WorkItemService'

const now = Date.now()

function createRepository(): WorkItemRepository & { items: Map<string, WorkItemRecord>; createCalls: unknown[] } {
  const items = new Map<string, WorkItemRecord>()
  const createCalls: unknown[] = []
  return {
    items,
    createCalls,
    async listWorkItems(params) {
      return [...items.values()].filter((row) => {
        if (params.status && row.status !== params.status) return false
        if (params.assigneeUserId && row.assigneeUserId !== params.assigneeUserId) return false
        return params.includeDeleted ? true : !row.deletedAt
      })
    },
    async getWorkItem({ itemId }) {
      const item = items.get(itemId)
      if (!item || item.deletedAt) return null
      const detail: WorkItemDetail = {
        item,
        children: [...items.values()].filter((row) => row.parentItemId === itemId && !row.deletedAt),
      }
      return detail
    },
    async createWorkItem(params) {
      createCalls.push(params)
      const id = `item_${items.size + 1}`
      items.set(id, {
        _id: id,
        userId: params.userId,
        reporterUserId: params.userId,
        workspaceId: params.workspaceId,
        scope: params.scope ?? 'personal',
        title: params.title,
        status: params.status ?? 'todo',
        priority: params.priority ?? 'none',
        orderKey: '0'.repeat(19) + '1',
        itemNumber: items.size,
        createdAt: now,
        updatedAt: now,
      })
      return id
    },
    async updateWorkItem(params) {
      const item = items.get(params.itemId)
      if (!item) throw new Error('Unauthorized')
      if (params.expectedUpdatedAt !== undefined && item.updatedAt !== params.expectedUpdatedAt) {
        throw new Error('WORK_ITEM_REVISION_CONFLICT:' + item.updatedAt)
      }
      Object.assign(item, {
        ...(params.title !== undefined ? { title: params.title } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.priority ? { priority: params.priority } : {}),
        updatedAt: item.updatedAt + 1,
      })
    },
    async reorderWorkItem({ itemId, status, orderKey }) {
      const item = items.get(itemId)!
      item.orderKey = orderKey
      if (status) item.status = status
    },
    async setWorkItemScope({ itemId, to }) {
      const item = items.get(itemId)
      if (!item) return { ok: false, reason: 'not_found' }
      item.scope = to
      return { ok: true }
    },
    async archiveWorkItem({ itemId }) {
      const item = items.get(itemId)
      if (!item || item.archivedAt) return { ok: false, reason: item ? 'already_archived' : 'not_found' }
      item.archivedAt = now
      return { ok: true }
    },
    async restoreWorkItem({ itemId }) {
      const item = items.get(itemId)
      if (!item || !item.archivedAt) return { ok: false, reason: item ? 'not_archived' : 'not_found' }
      item.archivedAt = undefined
      return { ok: true }
    },
    async deleteWorkItem({ itemId }) {
      const item = items.get(itemId)
      if (!item) throw new Error('Unauthorized')
      item.deletedAt = now
    },
    async searchWorkItems({ text }) {
      return [...items.values()].filter((row) => row.title.toLowerCase().includes(text.toLowerCase()) && !row.deletedAt)
    },
  }
}

test('create requires a title and passes normalized input to the repository', async () => {
  const repo = createRepository()
  const service = new WorkItemService(repo)
  await assert.rejects(
    () => service.createWorkItem({ userId: 'u1', workspaceId: 'w1', title: '   ' }),
    (error: unknown) => error instanceof WorkItemServiceError && error.statusCode === 400,
  )
  const result = await service.createWorkItem({ userId: 'u1', workspaceId: 'w1', title: '  Write spec  ', priority: 'high' })
  assert.equal(result.workItemId, 'item_1')
  assert.equal((repo.createCalls[0] as { title: string }).title, 'Write spec')
})

test('update enforces expectedUpdatedAt before writing', async () => {
  const repo = createRepository()
  const service = new WorkItemService(repo)
  const { workItemId } = await service.createWorkItem({ userId: 'u1', title: 'Draft' })
  const detail = await service.getWorkItem({ itemId: workItemId, userId: 'u1' })
  const fresh = detail!.item.updatedAt

  await assert.rejects(
    () => service.updateWorkItem({ itemId: workItemId, userId: 'u1', title: 'stale', expectedUpdatedAt: fresh - 1 }),
    (error: unknown) => error instanceof WorkItemRevisionConflictError && error.currentUpdatedAt === fresh,
  )
  // The stale write never reached the repository.
  assert.equal(repo.items.get(workItemId)!.title, 'Draft')

  await service.updateWorkItem({ itemId: workItemId, userId: 'u1', title: 'fresh', expectedUpdatedAt: fresh })
  assert.equal(repo.items.get(workItemId)!.title, 'fresh')
})

test('update without expectedUpdatedAt writes through; missing item is 404', async () => {
  const repo = createRepository()
  const service = new WorkItemService(repo)
  const { workItemId } = await service.createWorkItem({ userId: 'u1', title: 'Draft' })
  await service.updateWorkItem({ itemId: workItemId, userId: 'u1', status: 'in_progress' })
  assert.equal(repo.items.get(workItemId)!.status, 'in_progress')
  await assert.rejects(
    () => service.updateWorkItem({ itemId: 'missing', userId: 'u1', title: 'x', expectedUpdatedAt: 1 }),
    (error: unknown) => error instanceof WorkItemServiceError && error.statusCode === 404,
  )
})

test('scope actions delegate to the repository and return its result', async () => {
  const repo = createRepository()
  const service = new WorkItemService(repo)
  const { workItemId } = await service.createWorkItem({ userId: 'u1', workspaceId: 'w1', title: 'Scoped' })

  assert.deepEqual(await service.archiveWorkItem({ itemId: workItemId, userId: 'u1', workspaceId: 'w1' }), { ok: true })
  assert.deepEqual(await service.archiveWorkItem({ itemId: workItemId, userId: 'u1', workspaceId: 'w1' }), { ok: false, reason: 'already_archived' })
  assert.deepEqual(await service.restoreWorkItem({ itemId: workItemId, userId: 'u1', workspaceId: 'w1' }), { ok: true })
  assert.deepEqual(await service.setWorkItemScope({ itemId: workItemId, userId: 'u1', workspaceId: 'w1', to: 'workspace' }), { ok: true })
  assert.deepEqual(await service.archiveWorkItem({ itemId: 'missing', userId: 'u1' }), { ok: false, reason: 'not_found' })
})

test('delete marks the row deleted and hides it from reads', async () => {
  const repo = createRepository()
  const service = new WorkItemService(repo)
  const { workItemId } = await service.createWorkItem({ userId: 'u1', title: 'Temp' })
  await service.deleteWorkItem({ itemId: workItemId, userId: 'u1' })
  assert.equal(await service.getWorkItem({ itemId: workItemId, userId: 'u1' }), null)
  assert.equal((await service.listWorkItems({ userId: 'u1' })).length, 0)
})
