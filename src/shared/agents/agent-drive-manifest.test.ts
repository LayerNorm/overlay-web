import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentDriveCandidates, type AgentDriveScope } from './agent-drive-manifest'

const personal: AgentDriveScope = { kind: 'personal', workspaceId: 'workspace', ownerUserId: 'owner' }
const viewer = { userId: 'owner', role: 'member' as const }
const row = (_id: string, name: string, extra: Record<string, unknown> = {}) => ({
  _id, name, userId: 'owner', workspaceId: 'workspace', type: 'file', kind: 'note', content: 'full inline text', createdAt: 1, updatedAt: 2, ...extra,
})
const build = (rows: unknown[], scope = personal) => buildAgentDriveCandidates({ rows, scope, viewer })

test('personal and workspace manifests have disjoint authority and exclude archived or foreign data', () => {
  const rows = [row('mine', 'Mine'), row('legacy', 'Legacy', { scope: undefined }),
    row('other-person', 'Other person', { userId: 'other' }),
    row('shared', 'Shared', { userId: 'other', scope: 'workspace' }),
    row('archived', 'Archived', { archivedAt: 3 }), row('foreign', 'Foreign', { workspaceId: 'foreign' })]
  assert.deepEqual(build(rows).map(value => value.fileId), ['legacy', 'mine'])
  assert.deepEqual(build(rows, { kind: 'workspace', workspaceId: 'workspace' }).map(value => value.fileId), ['shared'])
  assert.deepEqual(buildAgentDriveCandidates({ rows, scope: personal, viewer: { userId: 'other', role: 'admin' } }), [])
  assert.deepEqual(buildAgentDriveCandidates({ rows, scope: personal, viewer: { userId: 'owner', role: 'guest' } }), [])
})

test('nested Unicode hierarchy preserves file identity and canonical text-object references', () => {
  const result = build([
    row('folder', '研究', { type: 'folder', kind: 'folder' }),
    row('child', 'café.md', { parentId: 'folder', textInObjectStore: true, r2Key: 'users/owner/files/child/version', content: 'search prefix only' }),
    row('inline', 'inline.md', { content: 'old', textContent: 'full canonical inline text' }),
  ])
  assert.equal(result.find(value => value.fileId === 'child')?.path, '研究/café.md')
  assert.deepEqual(result.find(value => value.fileId === 'child')?.source, { kind: 'object', key: 'users/owner/files/child/version' })
  assert.deepEqual(result.find(value => value.fileId === 'inline')?.source, { kind: 'inline', text: 'full canonical inline text' })
  assert.equal(result.find(value => value.fileId === 'folder')?.source, undefined)
  assert.throws(() => build([row('broken', 'broken', { textInObjectStore: true, storageId: 'some-original-blob' })]), /DRIVE_MISSING_CANONICAL_OBJECT/)
  assert.throws(() => build([row('foreign-key', 'foreign-key', { r2Key: 'users/another/files/private/content' })]), /DRIVE_INVALID_STORAGE_OWNER/)
})

test('missing or inaccessible parents are never silently flattened into the drive root', () => {
  assert.throws(() => build([row('child', 'child', { parentId: 'missing' })]), /DRIVE_INACCESSIBLE_PARENT/)
  assert.throws(() => build([row('parent', 'parent', { userId: 'other', type: 'folder' }), row('child', 'child', { parentId: 'parent' })]), /DRIVE_INACCESSIBLE_PARENT/)
  assert.throws(() => build([row('parent', 'not-folder'), row('child', 'child', { parentId: 'parent' })]), /DRIVE_INACCESSIBLE_PARENT/)
})

test('cycles, duplicate ids, unsafe names and portable-name collisions fail explicitly', () => {
  assert.throws(() => build([row('a', 'a', { type: 'folder', parentId: 'b' }), row('b', 'b', { type: 'folder', parentId: 'a' })]), /DRIVE_INVALID_HIERARCHY/)
  assert.throws(() => build([row('a', 'one'), row('a', 'two')]), /DRIVE_DUPLICATE_FILE_ID/)
  assert.throws(() => build([row('a', '../outside')]), /DRIVE_UNSAFE_PATH/)
  assert.throws(() => build([row('a', 'a/b')]), /DRIVE_UNSAFE_NAME/)
  assert.throws(() => build([row('a', 'Report.md'), row('b', 'report.md')]), /DRIVE_AMBIGUOUS_PATH/)
  assert.throws(() => build([row('a', 'café'), row('b', 'cafe\u0301')]), /DRIVE_AMBIGUOUS_PATH/)
  assert.throws(() => buildAgentDriveCandidates({ rows: [row('a', 'a'), row('b', 'b')], scope: personal, viewer, maxEntries: 1 }), /DRIVE_TOO_MANY_ENTRIES/)
})
