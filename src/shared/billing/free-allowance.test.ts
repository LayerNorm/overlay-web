import assert from 'node:assert/strict'
import test from 'node:test'
import { isWorkspaceAllowanceSubject, usageCountSubject, workspaceAllowanceSubject } from './free-allowance'

test('a free person counts under the workspace they are working in', () => {
  assert.equal(usageCountSubject({ userId: 'user_1', free: true, activeWorkspaceId: 'ws_a' }), 'workspace:ws_a')
})

test('two free people in one workspace share a subject, and one person in two workspaces has two', () => {
  const a = usageCountSubject({ userId: 'user_1', free: true, activeWorkspaceId: 'ws_a' })
  assert.equal(usageCountSubject({ userId: 'user_2', free: true, activeWorkspaceId: 'ws_a' }), a)
  assert.notEqual(usageCountSubject({ userId: 'user_1', free: true, activeWorkspaceId: 'ws_b' }), a)
})

test('a paid person and a person with no workspace keep counting under their own id', () => {
  assert.equal(usageCountSubject({ userId: 'user_1', free: false, activeWorkspaceId: 'ws_a' }), 'user_1')
  assert.equal(usageCountSubject({ userId: 'user_1', free: true, activeWorkspaceId: null }), 'user_1')
  assert.equal(usageCountSubject({ userId: 'user_1', free: true }), 'user_1')
})

test('workspace subjects are recognizable and never look like a user id', () => {
  assert.equal(isWorkspaceAllowanceSubject(workspaceAllowanceSubject('ws_a')), true)
  assert.equal(isWorkspaceAllowanceSubject('user_01ABC'), false)
})
