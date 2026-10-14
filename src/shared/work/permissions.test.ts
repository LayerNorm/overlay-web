import assert from 'node:assert/strict'
import test from 'node:test'
import { canWorkOnItem } from './permissions'
import type { ResourceScopePolicy, ResourceViewer } from '../workspaces/resource-scope'

const owner: ResourceViewer = { userId: 'owner', role: 'owner' }
const admin: ResourceViewer = { userId: 'admin', role: 'admin' }
const alice: ResourceViewer = { userId: 'alice', role: 'member' }
const bob: ResourceViewer = { userId: 'bob', role: 'member' }
const gus: ResourceViewer = { userId: 'gus', role: 'guest' }
const adminsOnly: ResourceScopePolicy = { workspaceExtensionsEditors: 'members', workspaceContentEditors: 'admins', memberCanMoveScope: true }

test('personal tasks are only worked on by their creator', () => {
  const row = { userId: 'alice', scope: 'personal' as const }
  assert.ok(canWorkOnItem(row, alice, 'p-alice'))
  for (const viewer of [owner, admin, bob, gus]) assert.ok(!canWorkOnItem(row, viewer, `p-${viewer.userId}`), viewer.userId)
})

test('workspace tasks can be worked on by members when the workspace lets members edit content', () => {
  const row = { userId: 'alice', scope: 'workspace' as const }
  for (const viewer of [owner, admin, alice, bob]) assert.ok(canWorkOnItem(row, viewer, `p-${viewer.userId}`), viewer.userId)
  assert.ok(!canWorkOnItem(row, gus, 'p-gus'))
  assert.ok(!canWorkOnItem(row, { userId: 'out', role: null }, null))
})

test('when only admins edit workspace content, a member can still work on a task assigned to them', () => {
  const row = { userId: 'alice', scope: 'workspace' as const, assigneePrincipalId: 'p-bob' }
  assert.ok(canWorkOnItem(row, bob, 'p-bob', adminsOnly))
  assert.ok(canWorkOnItem(row, alice, 'p-alice', adminsOnly))
  assert.ok(canWorkOnItem(row, admin, 'p-admin', adminsOnly))
  const carol: ResourceViewer = { userId: 'carol', role: 'member' }
  assert.ok(!canWorkOnItem(row, carol, 'p-carol', adminsOnly))
})

test('an archived workspace task keeps the scope it came from', () => {
  const row = { userId: 'alice', scope: 'personal' as const, archivedAt: 1, archivedFromScope: 'workspace' as const }
  assert.ok(canWorkOnItem(row, bob, 'p-bob'))
})
