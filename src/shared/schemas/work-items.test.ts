import assert from 'node:assert/strict'
import test from 'node:test'
import { CreateWorkItemRequest, UpdateWorkItemRequest } from './work-items'
import { WORK_ITEM_LIMITS, toWorkItemOrderKey } from '../work/work-items'

const fieldOf = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
  result.success ? undefined : result.error?.issues[0]?.path.join('.')

test('create rejects a bad status or priority instead of dropping it', () => {
  assert.equal(fieldOf(CreateWorkItemRequest.safeParse({ title: 't', status: 'blocked' })), 'status')
  assert.equal(fieldOf(CreateWorkItemRequest.safeParse({ title: 't', priority: 'asap' })), 'priority')
  assert.equal(CreateWorkItemRequest.safeParse({ title: 't', status: 'done', priority: 'urgent' }).success, true)
})

test('create and update enforce the text limits', () => {
  assert.equal(fieldOf(CreateWorkItemRequest.safeParse({ title: 'x'.repeat(WORK_ITEM_LIMITS.title + 1) })), 'title')
  assert.equal(CreateWorkItemRequest.safeParse({ title: 'x'.repeat(WORK_ITEM_LIMITS.title) }).success, true)
  assert.equal(fieldOf(CreateWorkItemRequest.safeParse({ title: 't', description: 'x'.repeat(WORK_ITEM_LIMITS.description + 1) })), 'description')
  assert.equal(fieldOf(UpdateWorkItemRequest.safeParse({ itemId: 'i', description: 'x'.repeat(WORK_ITEM_LIMITS.description + 1) })), 'description')
})

test('labels are capped in count and length and may not be blank', () => {
  const tooMany = Array.from({ length: WORK_ITEM_LIMITS.labelCount + 1 }, (_, i) => `l${i}`)
  assert.equal(fieldOf(CreateWorkItemRequest.safeParse({ title: 't', labels: tooMany })), 'labels')
  assert.equal(fieldOf(CreateWorkItemRequest.safeParse({ title: 't', labels: ['x'.repeat(WORK_ITEM_LIMITS.labelLength + 1)] })), 'labels.0')
  assert.equal(fieldOf(CreateWorkItemRequest.safeParse({ title: 't', labels: ['  '] })), 'labels.0')
  assert.equal(CreateWorkItemRequest.safeParse({ title: 't', labels: ['bug', 'p1'] }).success, true)
})

test('orderKey must be a fixed-width numeric key', () => {
  assert.equal(fieldOf(UpdateWorkItemRequest.safeParse({ itemId: 'i', orderKey: 'abc' })), 'orderKey')
  assert.equal(fieldOf(UpdateWorkItemRequest.safeParse({ itemId: 'i', orderKey: '12' })), 'orderKey')
  assert.equal(UpdateWorkItemRequest.safeParse({ itemId: 'i', orderKey: toWorkItemOrderKey(2048) }).success, true)
})

test('update needs an itemId and accepts the clear flags', () => {
  assert.equal(fieldOf(UpdateWorkItemRequest.safeParse({ title: 't' })), 'itemId')
  const parsed = UpdateWorkItemRequest.safeParse({ itemId: 'i', clearParent: true, clearStartDate: true, clearDueDate: true })
  assert.equal(parsed.success && parsed.data.clearParent, true)
  assert.equal(fieldOf(UpdateWorkItemRequest.safeParse({ itemId: 'i', dueDate: -1 })), 'dueDate')
  assert.equal(fieldOf(UpdateWorkItemRequest.safeParse({ itemId: 'i', action: 'delete' })), 'action')
})
