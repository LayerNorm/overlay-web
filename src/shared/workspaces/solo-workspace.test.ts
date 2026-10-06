import assert from 'node:assert/strict'
import test from 'node:test'
import { isSoloWorkspace, peopleInWorkspace, soloPanelScope, workspaceMemberLabel } from './solo-workspace'

test('a workspace with one person and the default agent is solo', () => {
  assert.equal(isSoloWorkspace({ humanMemberCount: 1, memberCount: 2 }), true)
})

test('a second person ends it, agents or not', () => {
  assert.equal(isSoloWorkspace({ humanMemberCount: 2, memberCount: 3 }), false)
})

test('an unknown count is not solo', () => {
  assert.equal(isSoloWorkspace({}), false)
  assert.equal(isSoloWorkspace(null), false)
})

test('the all-members count is only a fallback and never makes a shared workspace look solo', () => {
  assert.equal(peopleInWorkspace({ memberCount: 3 }), 3)
  assert.equal(isSoloWorkspace({ memberCount: 3 }), false)
  assert.equal(isSoloWorkspace({ memberCount: 1 }), true)
})

test('the member label counts people', () => {
  assert.equal(workspaceMemberLabel({ humanMemberCount: 1, memberCount: 2 }), '1 member')
  assert.equal(workspaceMemberLabel({ humanMemberCount: 3, memberCount: 4 }), '3 members')
  assert.equal(workspaceMemberLabel(null), null)
})

test('solo turns the Workspace scope into the Personal one', () => {
  assert.equal(soloPanelScope('workspace', true), 'personal')
  assert.equal(soloPanelScope('workspace', false), 'workspace')
})
