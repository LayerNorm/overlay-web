import assert from 'node:assert/strict'
import test from 'node:test'
import { translateWorkItemError } from './ConvexWorkItemRepository'
import { WorkItemRevisionConflictError, WorkItemServiceError } from './WorkItemService'

function caught(message: string): unknown {
  try {
    translateWorkItemError(new Error(message))
  } catch (error) {
    return error
  }
  return undefined
}

function serviceError(message: string) {
  const error = caught(message)
  assert.ok(error instanceof WorkItemServiceError, `expected a WorkItemServiceError for "${message}"`)
  return error
}

test('Convex errors map to the status the API should answer with', () => {
  assert.equal(serviceError('WORK_ITEM_PARENT_INVALID').statusCode, 400)
  assert.equal(serviceError('WORK_ITEM_ASSIGNEE_INVALID').statusCode, 400)
  assert.equal(serviceError('Unauthorized').statusCode, 403)
  const invalid = serviceError('WORK_ITEM_INVALID:title')
  assert.equal(invalid.statusCode, 400)
  assert.equal(invalid.message, 'Invalid title')
})

test('the code is found inside the wrapper Convex puts around a thrown error', () => {
  const wrapped = '[Request ID: abc] Server Error\nUncaught Error: '
  assert.equal(serviceError(`${wrapped}WORK_ITEM_PARENT_INVALID`).statusCode, 400)
  assert.equal(serviceError(`${wrapped}Unauthorized\n  at handler`).statusCode, 403)
  const conflict = caught(`${wrapped}WORK_ITEM_REVISION_CONFLICT:1700`)
  assert.ok(conflict instanceof WorkItemRevisionConflictError)
  assert.equal(conflict.currentUpdatedAt, 1700)
})

test('unknown errors are rethrown unchanged', () => {
  const error = caught('boom')
  assert.ok(error instanceof Error && !(error instanceof WorkItemServiceError))
  assert.equal(error.message, 'boom')
})
