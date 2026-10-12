import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_RESOURCE_SCOPE_POLICY,
  archivePatch,
  canCreateInScope,
  canEditResource,
  canReadResource,
  checkMoveResource,
  rowInView,
  rowScope,
  rowView,
  type ResourceScopePolicy,
  type ResourceViewer,
  type ScopedRow,
} from './resource-scope'

const owner: ResourceViewer = { userId: 'owner', role: 'owner' }
const admin: ResourceViewer = { userId: 'admin', role: 'admin' }
const member: ResourceViewer = { userId: 'member', role: 'member' }
const other: ResourceViewer = { userId: 'other', role: 'member' }
const guest: ResourceViewer = { userId: 'guest', role: 'guest' }
const outsider: ResourceViewer = { userId: 'out', role: null }
const everyone = [owner, admin, member, other, guest, outsider]

const personalByMember: ScopedRow = { userId: 'member', scope: 'personal' }
const workspaceByMember: ScopedRow = { userId: 'member', scope: 'workspace' }
const legacy: ScopedRow = { userId: 'member' }

test('rows from before scopes existed are personal; an archived row reports the scope it came from', () => {
  assert.equal(rowScope(legacy), 'personal')
  assert.equal(rowView(legacy), 'personal')
  assert.equal(rowScope({ userId: 'm', scope: 'workspace', archivedAt: 5, archivedFromScope: 'workspace' }), 'workspace')
  assert.equal(rowView({ userId: 'm', scope: 'workspace', archivedAt: 5, archivedFromScope: 'workspace' }), 'archived')
  assert.equal(rowScope({ userId: 'm', archivedAt: 5 }), 'personal')
})

test('read: personal is the creator only, workspace is every active member, guests and outsiders see nothing', () => {
  const readers = (row: ScopedRow) => everyone.filter((viewer) => canReadResource(row, viewer)).map((viewer) => viewer.userId)
  assert.deepEqual(readers(personalByMember), ['member'])
  assert.deepEqual(readers(legacy), ['member'])
  assert.deepEqual(readers(workspaceByMember), ['owner', 'admin', 'member', 'other'])
  // Archived rows follow the scope they were archived from.
  assert.deepEqual(readers({ ...personalByMember, archivedAt: 1, archivedFromScope: 'personal' }), ['member'])
  assert.deepEqual(readers({ ...workspaceByMember, archivedAt: 1, archivedFromScope: 'workspace' }), ['owner', 'admin', 'member', 'other'])
})

test('create: personal is always allowed for members; workspace follows the admin setting, per kind', () => {
  const policy = (patch: Partial<ResourceScopePolicy>): ResourceScopePolicy => ({ ...DEFAULT_RESOURCE_SCOPE_POLICY, ...patch })
  for (const kind of ['extension', 'content'] as const) {
    assert.equal(canCreateInScope(kind, 'personal', member), true)
    assert.equal(canCreateInScope(kind, 'personal', guest), false)
    assert.equal(canCreateInScope(kind, 'workspace', member), true, 'default: anyone in the workspace')
    assert.equal(canCreateInScope(kind, 'workspace', outsider), false)
  }
  const strictExtensions = policy({ workspaceExtensionsEditors: 'admins' })
  assert.equal(canCreateInScope('extension', 'workspace', member, strictExtensions), false)
  assert.equal(canCreateInScope('extension', 'workspace', admin, strictExtensions), true)
  assert.equal(canCreateInScope('extension', 'workspace', owner, strictExtensions), true)
  assert.equal(canCreateInScope('content', 'workspace', member, strictExtensions), true, 'content has its own setting')
  const strictContent = policy({ workspaceContentEditors: 'admins' })
  assert.equal(canCreateInScope('content', 'workspace', member, strictContent), false)
  assert.equal(canCreateInScope('extension', 'workspace', member, strictContent), true)
})

test('edit and archive: the creator always; owners and admins only for workspace items; never someone else\'s personal item', () => {
  const editors = (row: ScopedRow) => everyone.filter((viewer) => canEditResource(row, viewer)).map((viewer) => viewer.userId)
  assert.deepEqual(editors(personalByMember), ['member'])
  assert.deepEqual(editors(workspaceByMember), ['owner', 'admin', 'member'])
  assert.deepEqual(editors({ ...workspaceByMember, archivedAt: 1, archivedFromScope: 'workspace' }), ['owner', 'admin', 'member'])
})

test('move: only the creator, and not for archived rows or the scope they are already in', () => {
  assert.deepEqual(checkMoveResource('content', personalByMember, 'workspace', member), { ok: true })
  assert.deepEqual(checkMoveResource('content', workspaceByMember, 'personal', member), { ok: true })
  for (const viewer of [owner, admin, other, guest, outsider]) {
    assert.deepEqual(checkMoveResource('content', personalByMember, 'workspace', viewer), { ok: false, reason: 'not_creator' }, `${viewer.userId} cannot move someone else's item`)
    assert.deepEqual(checkMoveResource('content', workspaceByMember, 'personal', viewer), { ok: false, reason: 'not_creator' })
  }
  assert.deepEqual(checkMoveResource('content', { ...personalByMember, archivedAt: 1 }, 'workspace', member), { ok: false, reason: 'archived' })
  assert.deepEqual(checkMoveResource('content', personalByMember, 'personal', member), { ok: false, reason: 'same_scope' })
})

test('move: the admin switch stops members, never owners or admins moving their own items; moving to Workspace needs creation rights', () => {
  const off: ResourceScopePolicy = { ...DEFAULT_RESOURCE_SCOPE_POLICY, memberCanMoveScope: false }
  assert.deepEqual(checkMoveResource('content', personalByMember, 'workspace', member, off), { ok: false, reason: 'move_disabled' })
  assert.deepEqual(checkMoveResource('content', workspaceByMember, 'personal', member, off), { ok: false, reason: 'move_disabled' })
  const adminsOwn: ScopedRow = { userId: 'admin', scope: 'personal' }
  assert.deepEqual(checkMoveResource('content', adminsOwn, 'workspace', admin, off), { ok: true })
  const strict: ResourceScopePolicy = { ...DEFAULT_RESOURCE_SCOPE_POLICY, workspaceExtensionsEditors: 'admins' }
  assert.deepEqual(checkMoveResource('extension', personalByMember, 'workspace', member, strict), { ok: false, reason: 'workspace_creation_restricted' })
  assert.deepEqual(checkMoveResource('extension', workspaceByMember, 'personal', member, strict), { ok: true }, 'moving out of the workspace is always fine')
  assert.deepEqual(checkMoveResource('content', personalByMember, 'workspace', member, strict), { ok: true })
})

test('archiving records who archived and from which scope; views split by scope and archived state', () => {
  assert.deepEqual(archivePatch(workspaceByMember, admin, 99), { archivedAt: 99, archivedBy: 'admin', archivedFromScope: 'workspace' })
  assert.deepEqual(archivePatch(legacy, member, 7), { archivedAt: 7, archivedBy: 'member', archivedFromScope: 'personal' })
  assert.equal(rowInView(personalByMember, 'personal', member), true)
  assert.equal(rowInView(personalByMember, 'workspace', member), false)
  assert.equal(rowInView(personalByMember, 'personal', other), false)
  assert.equal(rowInView(workspaceByMember, 'workspace', other), true)
  const archived: ScopedRow = { ...workspaceByMember, archivedAt: 1, archivedFromScope: 'workspace' }
  assert.equal(rowInView(archived, 'archived', other), true, 'archived workspace items stay readable by members')
  assert.equal(rowInView(archived, 'workspace', other), false)
  assert.equal(rowInView({ ...personalByMember, archivedAt: 1, archivedFromScope: 'personal' }, 'archived', other), false)
})

test('item options offer only what the server would allow', async () => {
  const { scopeItemOptions } = await import('./resource-scope')
  const mine = { userId: 'member', scope: 'personal' as const }
  const owner = { userId: 'member', role: 'member' as const }
  const admin = { userId: 'admin', role: 'admin' as const }
  const sharedByMember = { userId: 'member', scope: 'workspace' as const }
  // Own personal item: move to Workspace, archive.
  assert.deepEqual(scopeItemOptions('content', mine, owner), { moveTo: 'workspace', canArchive: true, canRestore: false })
  // Own shared item: move back to Personal.
  assert.equal(scopeItemOptions('content', sharedByMember, owner).moveTo, 'personal')
  // An admin may archive someone else's workspace item, never move it.
  assert.deepEqual(scopeItemOptions('content', sharedByMember, admin), { moveTo: null, canArchive: true, canRestore: false })
  // Nobody touches another member's personal item.
  assert.deepEqual(scopeItemOptions('content', mine, admin), { moveTo: null, canArchive: false, canRestore: false })
  // Archived: restore, no move.
  assert.deepEqual(scopeItemOptions('content', { ...mine, archivedAt: 1, archivedFromScope: 'personal' }, owner), { moveTo: null, canArchive: false, canRestore: true })
  // Policy: moving off for members, extensions limited to admins.
  const noMove = { workspaceExtensionsEditors: 'members' as const, workspaceContentEditors: 'members' as const, memberCanMoveScope: false }
  assert.equal(scopeItemOptions('content', mine, owner, noMove).moveTo, null)
  assert.equal(scopeItemOptions('content', { userId: 'admin', scope: 'personal' }, admin, noMove).moveTo, 'workspace')
  const adminsOnlyExt = { workspaceExtensionsEditors: 'admins' as const, workspaceContentEditors: 'members' as const, memberCanMoveScope: true }
  assert.equal(scopeItemOptions('extension', mine, owner, adminsOnlyExt).moveTo, null)
  assert.equal(scopeItemOptions('content', mine, owner, adminsOnlyExt).moveTo, 'workspace')
})
