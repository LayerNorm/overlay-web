import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiRequestError } from '@overlay/api-client'
import { describeWorkError, isWorkConflict } from './work-errors'

test('a 409 is a conflict with its own wording', () => {
  const error = new ApiRequestError('The work item was updated elsewhere', 409)
  assert.equal(isWorkConflict(error), true)
  assert.match(describeWorkError(error, 'save that change'), /Someone else changed this task/)
})

test('a readable 4xx message from the server is shown as is', () => {
  assert.equal(describeWorkError(new ApiRequestError('Invalid title', 400), 'save that change'), 'Invalid title')
  assert.match(describeWorkError(new ApiRequestError('Forbidden', 403), 'delete that task'), /permission/)
})

test('network and server failures fall back to the action that failed', () => {
  assert.match(describeWorkError(new TypeError('Failed to fetch'), 'delete that task'), /^Could not delete that task/)
  assert.match(describeWorkError(new ApiRequestError('Failed to update work item', 500), 'save that change'), /^Could not save that change/)
  assert.equal(isWorkConflict(new Error('x')), false)
})
