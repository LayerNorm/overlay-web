import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentDriveContentService, driveUploadRecordSchema, driveContentResultSchema } from '../src/server/agents/AgentDriveContentService'
import { AgentDriveManifestService } from '../src/server/agents/AgentDriveManifestService'
import { AgentDriveMaterializer } from '../src/server/agents/AgentDriveMaterializer'
import { createAgentDriveTokens } from '../src/server/agents/agent-drive-token'
import { cleanupDriveVersions } from '../src/server/agents/cleanup-agent-drive-versions'
import { AgentDriveClient } from '../packages/overlay-agent-host/src/drive-client'
import { SqliteDriveJournal } from '../packages/overlay-agent-host/src/drive-journal'
import { AgentDriveWriter } from '../packages/overlay-agent-host/src/drive-writer'
import { AgentDriveCache } from '../packages/overlay-agent-host/src/drive-cache'
import { SqliteDriveSyncState } from '../packages/overlay-agent-host/src/drive-sync-state'
import { AgentDriveSynchronizer } from '../packages/overlay-agent-host/src/drive-sync'
import { handleAgentDriveRequest } from '../src/server/agents/agent-drive-http'
vi.mock('server-only', () => ({}))
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-drive-convex-tests-only'
const readRef = makeFunctionReference<'query'>('agents/agentDrive:manifestPageByServer')
const credentialRef = makeFunctionReference<'query'>('agents/agentDrive:credentialAuthorityByServer')
beforeEach(() => { process.env.INTERNAL_API_SECRET = secret; process.env.OVERLAY_CONNECTED_AGENT_DRIVE = '1' })
afterEach(() => vi.useRealTimers())

async function fixture() {
  const convex = convexTest(schema, modules)
  const now = Date.now()
  const ids = await convex.run(async ctx => {
    const workspace = await ctx.db.insert('workspaces', { workspaceId: 'w', kind: 'organization', name: 'Test', slug: 'test', status: 'active', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: 'p', workspaceId: 'w', userId: 'u', type: 'human', displayName: 'Test', createdAt: now, updatedAt: now })
    const membership = await ctx.db.insert('workspaceMemberships', { membershipId: 'member', workspaceId: 'w', principalId: 'p', role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    const agent = await ctx.db.insert('workspaceAgentDefinitions', { agentId: 'a', workspaceId: 'w', principalId: 'ap', name: 'Test', instructions: '', harness: 'codex', modelId: 'byo/codex', allowedToolIds: [], invocationPolicy: 'mention', visibility: 'creator', createdByPrincipalId: 'p', createdAt: now, updatedAt: now })
    const environment = await ctx.db.insert('agentEnvironments', { environmentId: 'e', workspaceId: 'w', kind: 'overlay_cloud', name: 'Test', status: 'online', capabilities: {}, createdAt: now, updatedAt: now })
    const binding = await ctx.db.insert('agentBindings', { bindingId: 'b', workspaceId: 'w', agentId: 'a', environmentId: 'e', protocolAdapter: 'acp', adapterConfig: {}, enabled: true, createdAt: now, updatedAt: now })
    const conversationId = await ctx.db.insert('conversations', { userId: 'u', workspaceId: 'w', title: 'Test', lastModified: now, createdAt: now, updatedAt: now, lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free' })
    const messageId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'u', turnId: 't', role: 'assistant', mode: 'act', content: '', contentType: 'text', status: 'generating', createdAt: now, updatedAt: now })
    const run = await ctx.db.insert('conversationAgentRuns', { externalRunId: 'r', conversationId, userId: 'u', userMessageId: messageId, assistantMessageId: messageId, turnId: 't', agentId: 'a', environmentId: 'e', bindingId: 'b', mode: 'room', runner: 'remote', status: 'running', createdAt: now, updatedAt: now })
    const session = await ctx.db.insert('agentRemoteSessions', { sessionId: 's', workspaceId: 'w', environmentId: 'e', bindingId: 'b', runId: 'r', status: 'running', attemptId: 's', executionGeneration: 1, hardDeadlineAt: now + 600000, commandCursor: 0, eventCursor: 0, capabilitySnapshot: {}, createdAt: now, updatedAt: now })
    for (let i = 0; i < 12; i++) await ctx.db.insert('files', { workspaceId: 'w', userId: 'u', name: `mine-${i}.md`, type: 'file', kind: 'note', content: `exact ${i}`, createdAt: now, updatedAt: now })
    await ctx.db.insert('files', { workspaceId: 'w', userId: 'other', name: 'private.md', type: 'file', kind: 'note', content: 'private', createdAt: now, updatedAt: now })
    await ctx.db.insert('files', { workspaceId: 'w', userId: 'other', scope: 'workspace', name: 'shared.md', type: 'file', kind: 'note', content: 'shared', createdAt: now, updatedAt: now })
    await ctx.db.insert('files', { workspaceId: 'foreign', userId: 'u', name: 'foreign.md', type: 'file', kind: 'note', content: 'foreign', createdAt: now, updatedAt: now })
    await ctx.db.insert('files', { workspaceId: 'w', userId: 'u', name: 'archived.md', type: 'file', kind: 'note', archivedAt: now, createdAt: now, updatedAt: now })
    return { workspace, membership, agent, environment, binding, run, session }
  })
  const args = { serverSecret: secret, actorUserId: 'u', agentId: 'a', environmentId: 'e', bindingId: 'b', runId: 'r', sessionId: 's', expiresAt: now + 300000,
    scope: { kind: 'personal' as const, workspaceId: 'w', ownerUserId: 'u' }, execution: { attemptId: 's', generation: 1 } }
  return { convex, ids, args, read: (patch: Record<string, unknown> = {}) => convex.query(readRef, { ...args, ...patch }) }
}

test('expected drive failures carry application data through production message redaction', async () => {
  const f = await fixture()
  await expect(f.read({ runId: 'foreign' })).rejects.toMatchObject({ data: 'DRIVE_RUN_UNAVAILABLE' })
  process.env.OVERLAY_CONNECTED_AGENT_DRIVE = '0'
  await expect(f.read()).rejects.toMatchObject({ data: 'DRIVE_DISABLED' })
})

test('drive credential authority is derived from the persisted execution and rechecks scope, membership and host opt-in', async () => {
  const f = await fixture()
  const request = { serverSecret: secret, workspaceId: 'w', environmentId: 'e', runId: 'r', sessionId: 's', execution: f.args.execution }
  const authority = await f.convex.query(credentialRef, request)
  expect(authority.claims).toMatchObject({ actorUserId: 'u', agentId: 'a', bindingId: 'b', runId: 'r', sessionId: 's',
    scope: { kind: 'personal', workspaceId: 'w', ownerUserId: 'u' }, execution: f.args.execution })
  expect(JSON.stringify(authority)).not.toContain(secret)
  expect(authority.claims.expiresAt).toBe(authority.hardDeadlineAt)
  for (const patch of [{ workspaceId: 'foreign' }, { environmentId: 'foreign' }, { runId: 'foreign' }, { sessionId: 'foreign' },
    { execution: undefined }, { execution: { attemptId: 's', generation: 2 } }]) {
    await expect(f.convex.query(credentialRef, { ...request, ...patch })).rejects.toMatchObject({ data: 'DRIVE_RUN_UNAVAILABLE' })
  }
  await f.convex.run(ctx => ctx.db.patch(f.ids.environment, { kind: 'local' }))
  await expect(f.convex.query(credentialRef, request)).rejects.toMatchObject({ data: 'DRIVE_RUN_UNAVAILABLE' })
  await f.convex.run(ctx => ctx.db.patch(f.ids.binding, { adapterConfig: { connectedAgentDrive: true } }))
  expect((await f.convex.query(credentialRef, request)).claims.scope.kind).toBe('personal')
  await f.convex.run(ctx => ctx.db.patch(f.ids.agent, { visibility: 'workspace' }))
  expect((await f.convex.query(credentialRef, request)).claims.scope).toEqual({ kind: 'workspace', workspaceId: 'w' })
  await f.convex.run(ctx => ctx.db.patch(f.ids.membership, { status: 'suspended' }))
  await expect(f.convex.query(credentialRef, request)).rejects.toMatchObject({ data: 'DRIVE_RUN_UNAVAILABLE' })
})

test('environment revocation timestamps revoke existing drive reads and credential renewal even before status catches up', async () => {
  const f = await fixture()
  await f.convex.run(ctx => ctx.db.patch(f.ids.environment, { revokedAt: Date.now() }))
  await expect(f.read()).rejects.toMatchObject({ data: 'DRIVE_RUN_UNAVAILABLE' })
  await expect(f.convex.query(credentialRef, { serverSecret: secret, workspaceId: 'w', environmentId: 'e',
    runId: 'r', sessionId: 's', execution: f.args.execution })).rejects.toMatchObject({ data: 'DRIVE_RUN_UNAVAILABLE' })
})

test('manifest pages preserve canonical rows and return only the fixed personal or workspace drive', async () => {
  const f = await fixture()
  const first = await f.read()
  expect(first.rows).toHaveLength(8)
  expect(first.nextCursor).not.toBeNull()
  const second = await f.read({ cursor: first.nextCursor })
  expect(second.rows).toHaveLength(4)
  expect(second.nextCursor).toBeNull()
  expect([...first.rows, ...second.rows].every(row => row.workspaceId === 'w' && row.userId === 'u')).toBe(true)
  expect(first.rows[0].content).toMatch(/^exact /)
  await expect(f.read({ scope: { kind: 'workspace', workspaceId: 'w' } })).rejects.toThrow(/DRIVE_RUN_UNAVAILABLE/)
  await f.convex.run(ctx => ctx.db.patch(f.ids.agent, { visibility: 'workspace' }))
  await expect(f.read()).rejects.toThrow(/DRIVE_RUN_UNAVAILABLE/)
  const shared = await f.read({ scope: { kind: 'workspace', workspaceId: 'w' } })
  expect(shared.rows.map(row => row.name)).toEqual(['shared.md'])
})

test('each page rechecks live binding, membership, workspace, environment and run state', async () => {
  for (const change of ['binding', 'membership', 'workspace', 'environment', 'run', 'session'] as const) {
    const f = await fixture()
    const first = await f.read()
    await f.convex.run(async ctx => {
      if (change === 'binding') await ctx.db.patch(f.ids.binding, { enabled: false })
      if (change === 'membership') await ctx.db.patch(f.ids.membership, { status: 'suspended' })
      if (change === 'workspace') await ctx.db.patch(f.ids.workspace, { status: 'archived' })
      if (change === 'environment') await ctx.db.patch(f.ids.environment, { status: 'revoked' })
      if (change === 'run') await ctx.db.patch(f.ids.run, { status: 'cancelled' })
      if (change === 'session') await ctx.db.patch(f.ids.session, { executionGeneration: 2 })
    })
    await expect(f.read({ cursor: first.nextCursor })).rejects.toThrow(/DRIVE_RUN_UNAVAILABLE/)
  }
})

test('invalid secrets, disabled feature, expired claims, stale attempts and non-opted-in local hosts fail closed', async () => {
  const f = await fixture()
  await expect(f.read({ serverSecret: 'wrong' })).rejects.toThrow(/Unauthorized/)
  process.env.OVERLAY_CONNECTED_AGENT_DRIVE = '0'
  await expect(f.read()).rejects.toThrow(/DRIVE_DISABLED/)
  process.env.OVERLAY_CONNECTED_AGENT_DRIVE = '1'
  await expect(f.read({ expiresAt: 0 })).rejects.toThrow(/DRIVE_RUN_UNAVAILABLE/)
  await expect(f.read({ sessionId: 'old' })).rejects.toThrow(/DRIVE_RUN_UNAVAILABLE/)
  await expect(f.read({ actorUserId: 'other' })).rejects.toThrow(/DRIVE_RUN_UNAVAILABLE/)
  await f.convex.run(ctx => ctx.db.patch(f.ids.environment, { kind: 'local' }))
  await expect(f.read()).rejects.toThrow(/DRIVE_RUN_UNAVAILABLE/)
  await f.convex.run(ctx => ctx.db.patch(f.ids.binding, { adapterConfig: { connectedAgentDrive: true } }))
  expect((await f.read()).rows).toHaveLength(8)
})

test('Convex downloads require the exact accessible Files revision and recheck authority', async () => {
  const f = await fixture()
  const ref = makeFunctionReference<'query'>('agents/agentDrive:storageSourceByServer')
  const file = await f.convex.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['canonical bytes']))
    const fileId = await ctx.db.insert('files', { workspaceId: 'w', userId: 'u', name: 'binary.bin', type: 'file', kind: 'upload', storageId, createdAt: 1, updatedAt: 2 })
    return { storageId, fileId, updatedAt: 2 }
  })
  const read = (patch = {}) => f.convex.query(ref, { ...f.args, ...file, ...patch })
  expect((await read()).sizeBytes).toBe(15)
  await expect(read({ updatedAt: 1 })).rejects.toThrow(/DRIVE_SOURCE_CHANGED/)
  const foreignStorage = await f.convex.run(ctx => ctx.storage.store(new Blob(['foreign'])))
  await expect(read({ storageId: foreignStorage })).rejects.toThrow(/DRIVE_SOURCE_CHANGED/)
  await f.convex.run(ctx => ctx.db.patch(file.fileId, { scope: 'workspace' }))
  await expect(read()).rejects.toThrow(/DRIVE_SOURCE_CHANGED/)
  await f.convex.run(ctx => ctx.db.patch(file.fileId, { scope: 'personal', deletedAt: 3 }))
  await expect(read()).rejects.toThrow(/DRIVE_SOURCE_CHANGED/)
  await f.convex.run(ctx => ctx.db.patch(file.fileId, { deletedAt: undefined }))
  await f.convex.run(ctx => ctx.db.patch(f.ids.binding, { enabled: false }))
  await expect(read()).rejects.toThrow(/DRIVE_RUN_UNAVAILABLE/)
})

test('metadata-only pages omit inline bodies and inline downloads enforce exact current revision', async () => {
  const f = await fixture()
  const page = await f.read({ metadataOnly: true })
  expect(page.rows).toHaveLength(12)
  expect(page.rows.every(row => row.content === undefined && row.textContent === undefined && row.driveInline.sizeBytes > 0)).toBe(true)
  const row = page.rows[0]
  const inlineRef = makeFunctionReference<'query'>('agents/agentDrive:inlineSourceByServer')
  const fileRef = makeFunctionReference<'query'>('agents/agentDrive:fileByServer')
  const args = { ...f.args, fileId: row._id, updatedAt: row.updatedAt }
  const source = await f.convex.query(inlineRef, args)
  expect(new TextEncoder().encode(source.text).byteLength).toBe(row.driveInline.sizeBytes)
  expect((await f.convex.query(fileRef, args)).content).toBe(source.text)
  await f.convex.run(ctx => ctx.db.patch(row._id, { updatedAt: row.updatedAt + 1, content: 'new bytes' }))
  await expect(f.convex.query(inlineRef, args)).rejects.toThrow(/DRIVE_SOURCE_CHANGED/)
  await expect(f.convex.query(fileRef, args)).rejects.toThrow(/DRIVE_SOURCE_CHANGED/)
})

const metadataRef = makeFunctionReference<'mutation'>('agents/agentDriveMetadata:commitByServer')

test('metadata commits preserve identity, monotonic revisions and exact retry receipts', async () => {
  const f = await fixture()
  const mkdir = { ...f.args, requestId: 'create-folder-0001', operation: { kind: 'mkdir', name: '研究' } }
  const folder = await f.convex.mutation(metadataRef, mkdir)
  expect(await f.convex.mutation(metadataRef, mkdir)).toEqual(folder)
  await expect(f.convex.mutation(metadataRef, { ...mkdir, operation: { kind: 'mkdir', name: 'other' } })).rejects.toMatchObject({ data: 'DRIVE_REQUEST_CONFLICT' })
  const move = { ...f.args, requestId: 'move-folder-00001', operation: { kind: 'move', fileId: folder.fileId, path: '研究', updatedAt: folder.updatedAt, name: 'renamed' } }
  const moved = await f.convex.mutation(metadataRef, move)
  expect(moved.fileId).toBe(folder.fileId)
  expect(moved.updatedAt).toBeGreaterThan(folder.updatedAt)
  expect(await f.convex.mutation(metadataRef, move)).toEqual(moved)
  await expect(f.convex.mutation(metadataRef, { ...move, requestId: 'stale-move-000001' })).rejects.toMatchObject({ data: 'DRIVE_SOURCE_CHANGED' })
  const removed = await f.convex.mutation(metadataRef, { ...f.args, requestId: 'remove-folder-001', operation: { kind: 'remove', fileId: moved.fileId, path: 'renamed', updatedAt: moved.updatedAt } })
  expect(removed.updatedAt).toBeGreaterThan(moved.updatedAt)
  expect((await f.convex.run(ctx => ctx.db.get(moved.fileId)))?.deletedAt).toBe(removed.updatedAt)
})

test('metadata writes reject unsafe paths, collisions, cycles and cross-scope parents', async () => {
  const f = await fixture()
  const create = (name: string, requestId: string, parentId?: string) => f.convex.mutation(metadataRef, { ...f.args, requestId, operation: { kind: 'mkdir', name, ...(parentId ? { parentId } : {}) } })
  for (const name of ['..', 'a/b', 'a\\b', 'x\u0000', 'CON', 'nul.txt', 'file.', 'x:y']) await expect(create(name, 'unsafe-path-00001')).rejects.toMatchObject({ data: 'DRIVE_UNSAFE_PATH' })
  const folder = await create('folder', 'safe-folder-00001')
  await expect(create('folder', 'collision-000001')).rejects.toMatchObject({ data: 'DRIVE_PATH_CONFLICT' })
  await expect(create('FOLDER', 'case-collision01')).rejects.toMatchObject({ data: 'DRIVE_PATH_CONFLICT' })
  await create('café', 'unicode-folder01')
  await expect(create('cafe\u0301', 'unicode-conflict')).rejects.toMatchObject({ data: 'DRIVE_PATH_CONFLICT' })
  await expect(f.convex.mutation(metadataRef, { ...f.args, requestId: 'parent-cycle-001', operation: { kind: 'move', fileId: folder.fileId, path: 'folder', updatedAt: folder.updatedAt, name: 'folder', parentId: folder.fileId } })).rejects.toMatchObject({ data: 'DRIVE_UNSAFE_PATH' })
  const foreign = await f.convex.run(ctx => ctx.db.insert('files', { workspaceId: 'foreign', userId: 'u', name: 'foreign', type: 'folder', kind: 'folder', createdAt: 1, updatedAt: 1 }))
  await expect(create('child', 'foreign-parent-01', foreign)).rejects.toMatchObject({ data: 'DRIVE_EDIT_DENIED' })
})

test('a folder deletion cannot implicitly remove an unhydrated remote child', async () => {
  const f = await fixture()
  const folder = await f.convex.mutation(metadataRef, { ...f.args, requestId: 'folder-delete-001', operation: { kind: 'mkdir', name: 'folder' } })
  await f.convex.run(ctx => ctx.db.insert('files', { userId: 'u', workspaceId: 'w', name: 'unhydrated.bin', parentId: folder.fileId, type: 'file', kind: 'upload', createdAt: 1, updatedAt: 1 }))
  await expect(f.convex.mutation(metadataRef, { ...f.args, requestId: 'delete-parent-01', operation: { kind: 'remove', fileId: folder.fileId, path: 'folder', updatedAt: folder.updatedAt } })).rejects.toMatchObject({ data: 'DRIVE_DIRECTORY_NOT_EMPTY' })
  expect((await f.convex.run(ctx => ctx.db.get(folder.fileId)))?.deletedAt).toBeUndefined()
})

test('receipt replay never bypasses run revocation and read access never grants edit access', async () => {
  const f = await fixture()
  const args = { ...f.args, requestId: 'replay-revoked-01', operation: { kind: 'mkdir', name: 'folder' } }
  await f.convex.mutation(metadataRef, args)
  await f.convex.run(ctx => ctx.db.patch(f.ids.binding, { enabled: false }))
  await expect(f.convex.mutation(metadataRef, args)).rejects.toMatchObject({ data: 'DRIVE_RUN_UNAVAILABLE' })
  await f.convex.run(async ctx => { await ctx.db.patch(f.ids.binding, { enabled: true }); await ctx.db.patch(f.ids.agent, { visibility: 'workspace' }) })
  const shared = await f.read({ scope: { kind: 'workspace', workspaceId: 'w' } })
  const row = shared.rows[0]
  await expect(f.convex.mutation(metadataRef, { ...f.args, scope: { kind: 'workspace', workspaceId: 'w' }, requestId: 'readonly-move-01', operation: { kind: 'move', fileId: row._id, path: row.name, updatedAt: row.updatedAt, name: 'stolen.md' } })).rejects.toMatchObject({ data: 'DRIVE_EDIT_DENIED' })
})


test('metadata tombstones retain object quota charges and promote canonical duplicates', async () => {
  const f = await fixture()
  const ids = await f.convex.run(async ctx => {
    const subscription = await ctx.db.insert('subscriptions', { userId: 'u', overlayStorageBytesUsed: 300 })
    const inline = await ctx.db.insert('files', { userId: 'u', workspaceId: 'w', name: 'inline.md', type: 'file', kind: 'note', content: 'inline', sizeBytes: 100, createdAt: 1, updatedAt: 1 })
    const blob = await ctx.db.insert('files', { userId: 'u', workspaceId: 'w', name: 'blob.bin', type: 'file', kind: 'upload', r2Key: 'users/u/files/immutable/version', sizeBytes: 200, createdAt: 1, updatedAt: 1 })
    const duplicate = await ctx.db.insert('files', { userId: 'u', workspaceId: 'w', name: 'copy.md', type: 'file', kind: 'note', content: 'inline', duplicateOfFileId: inline, createdAt: 1, updatedAt: 1 })
    return { subscription, inline, blob, duplicate }
  })
  for (const [fileId, requestId] of [[ids.inline, 'delete-inline-01'], [ids.blob, 'delete-object-01']] as const) {
    const args = { ...f.args, requestId, operation: { kind: 'remove', fileId, path: fileId === ids.inline ? 'inline.md' : 'blob.bin', updatedAt: 1 } }
    await f.convex.mutation(metadataRef, args)
    await f.convex.mutation(metadataRef, args)
  }
  const state = await f.convex.run(async ctx => ({ subscription: await ctx.db.get(ids.subscription), duplicate: await ctx.db.get(ids.duplicate), blob: await ctx.db.get(ids.blob) }))
  expect(state.subscription?.overlayStorageBytesUsed).toBe(200)
  expect(state.duplicate?.duplicateOfFileId).toBeUndefined()
  expect(state.duplicate?.indexStatus).toBe('pending')
  expect(state.blob?.r2Key).toBe('users/u/files/immutable/version')
})

test('a new execution generation cannot reuse an earlier metadata receipt', async () => {
  const f = await fixture()
  const args = { ...f.args, requestId: 'attempt-replay-01', operation: { kind: 'mkdir', name: 'folder' } }
  await f.convex.mutation(metadataRef, args)
  await f.convex.run(ctx => ctx.db.patch(f.ids.session, { attemptId: 'replacement', executionGeneration: 2 }))
  await expect(f.convex.mutation(metadataRef, args)).rejects.toMatchObject({ data: 'DRIVE_RUN_UNAVAILABLE' })
  await expect(f.convex.mutation(metadataRef, { ...args, execution: { attemptId: 'replacement', generation: 2 } })).rejects.toMatchObject({ data: 'DRIVE_REQUEST_CONFLICT' })
})


test('a moved ancestor invalidates a hydrated child path even when its own revision is unchanged', async () => {
  const f = await fixture()
  const ids = await f.convex.run(async ctx => {
    const parent = await ctx.db.insert('files', { userId: 'u', workspaceId: 'w', name: 'old', type: 'folder', createdAt: 1, updatedAt: 1 })
    const child = await ctx.db.insert('files', { userId: 'u', workspaceId: 'w', name: 'report.md', parentId: parent, type: 'file', kind: 'note', content: 'preserve', createdAt: 1, updatedAt: 1 })
    await ctx.db.patch(parent, { name: 'renamed', updatedAt: 2 })
    return { parent, child }
  })
  await expect(f.convex.mutation(metadataRef, { ...f.args, requestId: 'stale-parent-001', operation: { kind: 'remove', fileId: ids.child, path: 'old/report.md', updatedAt: 1 } })).rejects.toMatchObject({ data: 'DRIVE_SOURCE_CHANGED' })
  expect((await f.convex.run(ctx => ctx.db.get(ids.child)))?.content).toBe('preserve')
})

const uploadIntent = makeFunctionReference<'mutation'>('agents/agentDriveUploads:intentByServer')
const uploadCommit = makeFunctionReference<'mutation'>('agents/agentDriveUploads:commitByServer')
const uploadRead = makeFunctionReference<'query'>('agents/agentDriveUploads:readByServer')
const cleanupClaim = makeFunctionReference<'mutation'>('agents/agentDriveCleanup:claimByServer')
const cleanupAck = makeFunctionReference<'mutation'>('agents/agentDriveCleanup:acknowledgeByServer')
const writeHash = 'a'.repeat(64)
function writeInput(sequence = 1) {
  return { requestId: `write-request-${String(sequence).padStart(4, '0')}`,
    uploadId: `24b3d8ed-21b2-43f3-9617-${String(sequence).padStart(12, '0')}`,
    operation: { kind: 'create', name: 'report.txt' }, sha256: writeHash, sizeBytes: 40000, mimeType: 'text/plain' }
}

test('upload intents and verified commits keep immutable identities and publish one real Files row', async () => {
  const f = await fixture()
  const input = writeInput()
  const intent = await f.convex.mutation(uploadIntent, { ...f.args, ...input })
  expect(intent.stagingKey).not.toBe(intent.finalKey)
  expect(intent.finalKey).toBe(`users/u/files/${input.uploadId}/report.txt`)
  expect(await f.convex.mutation(uploadIntent, { ...f.args, ...input, uploadId: writeInput(2).uploadId })).toEqual(intent)
  await expect(f.convex.mutation(uploadIntent, { ...f.args, ...input, sizeBytes: 1 })).rejects.toMatchObject({ data: 'DRIVE_REQUEST_CONFLICT' })
  const commit = { ...f.args, uploadId: input.uploadId, verifiedSha256: writeHash, verifiedSizeBytes: 40000, textPrefix: 'searchable prefix' }
  await expect(f.convex.mutation(uploadCommit, { ...commit, verifiedSha256: 'b'.repeat(64) })).rejects.toMatchObject({ data: 'DRIVE_UPLOAD_CHANGED' })
  const result = await f.convex.mutation(uploadCommit, commit)
  expect(result).toMatchObject({ name: 'report.txt', conflict: false, sizeBytes: 40000, sha256: writeHash })
  expect(await f.convex.mutation(uploadCommit, commit)).toEqual(result)
  const state = await f.convex.run(async ctx => ({ row: await ctx.db.get(result.fileId),
    usage: await ctx.db.query('subscriptions').withIndex('by_userId', q => q.eq('userId', 'u')).unique(),
    uploads: await ctx.db.query('agentDriveWriteBudgets').withIndex('by_runId', q => q.eq('runId', 'r')).unique() }))
  expect(state.row).toMatchObject({ r2Key: intent.finalKey, textInObjectStore: true, content: 'searchable prefix', sizeBytes: 40000 })
  expect(state.usage?.overlayStorageBytesUsed).toBe(40000)
  expect(state.uploads).toMatchObject({ uploads: 1, bytes: 40000 })
})

test('stale revisions and colliding creates save distinct conflict copies while normal replacement preserves identity', async () => {
  const f = await fixture()
  const first = writeInput()
  await f.convex.mutation(uploadIntent, { ...f.args, ...first })
  const initial = await f.convex.mutation(uploadCommit, { ...f.args, uploadId: first.uploadId,
    verifiedSha256: writeHash, verifiedSizeBytes: first.sizeBytes, textPrefix: 'first' })
  const second = { ...writeInput(2), operation: { kind: 'replace', fileId: initial.fileId, path: 'report.txt', updatedAt: initial.updatedAt } }
  await f.convex.mutation(uploadIntent, { ...f.args, ...second })
  const replacement = await f.convex.mutation(uploadCommit, { ...f.args, uploadId: second.uploadId,
    verifiedSha256: writeHash, verifiedSizeBytes: second.sizeBytes, textPrefix: 'replacement' })
  expect(replacement.fileId).toBe(initial.fileId)
  const stale = { ...writeInput(3), operation: second.operation }
  await f.convex.mutation(uploadIntent, { ...f.args, ...stale })
  const conflict = await f.convex.mutation(uploadCommit, { ...f.args, uploadId: stale.uploadId,
    verifiedSha256: writeHash, verifiedSizeBytes: stale.sizeBytes, textPrefix: 'conflict' })
  expect(conflict).toMatchObject({ name: 'report (agent).txt', conflict: true })
  expect(conflict.fileId).not.toBe(initial.fileId)
  const original = await f.convex.run(ctx => ctx.db.get(initial.fileId))
  expect(original?.content).toBe('replacement')
  const collision = writeInput(4)
  await f.convex.mutation(uploadIntent, { ...f.args, ...collision })
  expect(await f.convex.mutation(uploadCommit, { ...f.args, uploadId: collision.uploadId,
    verifiedSha256: writeHash, verifiedSizeBytes: collision.sizeBytes, textPrefix: 'collision' }))
    .toMatchObject({ name: 'report (agent 2).txt', conflict: true })
})

test('superseded drive versions remain charged through retention, shared references and cleanup retries', async () => {
  const f = await fixture()
  const first = writeInput()
  const original = await f.convex.mutation(uploadIntent, { ...f.args, ...first })
  const initial = await f.convex.mutation(uploadCommit, { ...f.args, uploadId: first.uploadId,
    verifiedSha256: writeHash, verifiedSizeBytes: first.sizeBytes, textPrefix: 'first' })
  const next = { ...writeInput(2), operation: { kind: 'replace', fileId: initial.fileId, path: 'report.txt', updatedAt: initial.updatedAt } }
  await f.convex.mutation(uploadIntent, { ...f.args, ...next })
  await f.convex.mutation(uploadCommit, { ...f.args, uploadId: next.uploadId,
    verifiedSha256: writeHash, verifiedSizeBytes: next.sizeBytes, textPrefix: 'new version' })
  const claim = { serverSecret: secret, claim: 'cleanup-attempt-0001' }
  expect(await f.convex.mutation(cleanupClaim, claim)).toEqual({ objects: [], convexDeleted: 0 })
  const retired = await f.convex.run(async ctx => {
    const row = (await ctx.db.query('agentDriveRetiredObjects').collect()).find(row => row.purpose === 'version')
    if (!row) throw Error('retirement must be atomic with replacement')
    await ctx.db.patch(row._id, { nextAttemptAt: 0 })
    return row
  })
  const shared = await f.convex.run(ctx => ctx.db.insert('files', { userId: 'u', workspaceId: 'w', name: 'archived-copy.txt',
    type: 'file', kind: 'upload', r2Key: original.finalKey, archivedAt: Date.now(), sizeBytes: first.sizeBytes, createdAt: Date.now(), updatedAt: Date.now() }))
  expect(await f.convex.mutation(cleanupClaim, claim)).toEqual({ objects: [], convexDeleted: 0 })
  await f.convex.run(async ctx => { await ctx.db.delete(shared); await ctx.db.patch(retired._id, { nextAttemptAt: 0 }) })
  await expect(f.convex.mutation(cleanupClaim, { ...claim, serverSecret: 'wrong' })).rejects.toThrow('Unauthorized')
  expect(await f.convex.mutation(cleanupClaim, claim)).toEqual({ objects: [{ id: retired._id, key: original.finalKey }], convexDeleted: 0 })
  expect(await f.convex.mutation(cleanupClaim, claim)).toEqual({ objects: [], convexDeleted: 0 })
  const usage = () => f.convex.run(async ctx => (await ctx.db.query('subscriptions').withIndex('by_userId', q => q.eq('userId', 'u')).unique())?.overlayStorageBytesUsed)
  expect(await usage()).toBe(first.sizeBytes + next.sizeBytes)
  // A crashed worker leaves its claim retryable; its late acknowledgement cannot win a newer claim.
  await f.convex.run(ctx => ctx.db.patch(retired._id, { nextAttemptAt: 0 }))
  const retry = { ...claim, claim: 'cleanup-attempt-0002' }
  expect((await f.convex.mutation(cleanupClaim, retry)).objects).toHaveLength(1)
  expect(await f.convex.mutation(cleanupAck, { ...claim, id: retired._id })).toBe(false)
  expect(await usage()).toBe(first.sizeBytes + next.sizeBytes)
  expect(await f.convex.mutation(cleanupAck, { ...retry, id: retired._id })).toBe(true)
  expect(await f.convex.mutation(cleanupAck, { ...retry, id: retired._id })).toBe(true)
  expect(await usage()).toBe(next.sizeBytes)
  const current = await f.convex.run(ctx => ctx.db.get(initial.fileId))
  expect(current?.content).toBe('new version')
  expect(current?.r2Key).not.toBe(original.finalKey)
})

test('retired Convex blobs delete transactionally only after their last Files reference disappears', async () => {
  const f = await fixture()
  const stored = await f.convex.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['retained']))
    const fileId = await ctx.db.insert('files', { userId: 'u', workspaceId: 'w', name: 'retained.txt', type: 'file', kind: 'upload',
      storageId, sizeBytes: 8, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: Date.now() })
    await ctx.db.insert('agentDriveRetiredObjects', { ownerUserId: 'u', purpose: 'version', sizeBytes: 8, source: { kind: 'convex', storageId },
      retiredAt: 0, nextAttemptAt: 0, state: { kind: 'waiting' } })
    await ctx.db.insert('subscriptions', { userId: 'u', overlayStorageBytesUsed: 8 })
    return { storageId, fileId }
  })
  const claim = { serverSecret: secret, claim: 'cleanup-convex-attempt' }
  expect(await f.convex.mutation(cleanupClaim, claim)).toEqual({ objects: [], convexDeleted: 0 })
  expect(await f.convex.run(async ctx => await (await ctx.storage.get(stored.storageId))?.text())).toBe('retained')
  await f.convex.run(async ctx => {
    await ctx.db.delete(stored.fileId)
    const retired = await ctx.db.query('agentDriveRetiredObjects').unique()
    if (retired) await ctx.db.patch(retired._id, { nextAttemptAt: 0 })
  })
  expect(await f.convex.mutation(cleanupClaim, claim)).toEqual({ objects: [], convexDeleted: 1 })
  expect(await f.convex.run(async ctx => await ctx.storage.get(stored.storageId) === null)).toBe(true)
  expect(await f.convex.run(async ctx => (await ctx.db.query('subscriptions').withIndex('by_userId', q => q.eq('userId', 'u')).unique())?.overlayStorageBytesUsed)).toBe(0)
})

test('upload cleanup removes abandoned bytes and staging while preserving a committed final after a lost response', async () => {
  const f = await fixture()
  const first = writeInput()
  const committed = await f.convex.mutation(uploadIntent, { ...f.args, ...first })
  // A response can be lost after this transaction has already published Files.
  const result = await f.convex.mutation(uploadCommit, { ...f.args, uploadId: first.uploadId,
    verifiedSha256: writeHash, verifiedSizeBytes: first.sizeBytes, textPrefix: 'retained canonical bytes' })
  const abandoned = await f.convex.mutation(uploadIntent, { ...f.args, ...writeInput(2) })
  await f.convex.mutation(uploadIntent, { ...f.args, ...writeInput(2), uploadId: writeInput(3).uploadId })
  const objects = new Set([committed.stagingKey, committed.finalKey, abandoned.stagingKey, abandoned.finalKey])
  const queued = await f.convex.run(ctx => ctx.db.query('agentDriveRetiredObjects').collect())
  expect(queued).toHaveLength(4)
  expect(queued.every(row => row.nextAttemptAt > committed.expiresAt + 24 * 60 * 60_000)).toBe(true)
  expect(committed.retireAt).toBeGreaterThan(Math.max(...queued.map(row => row.nextAttemptAt)))
  expect(await f.convex.mutation(cleanupClaim, { serverSecret: secret, claim: 'cleanup-before-deadline' })).toEqual({ objects: [], convexDeleted: 0 })
  await f.convex.run(async ctx => {
    for (const row of queued) await ctx.db.patch(row._id, { nextAttemptAt: 0 })
    for (const row of await ctx.db.query('agentDriveUploads').collect()) await ctx.db.patch(row._id, { retireAt: 0 })
    for (const row of await ctx.db.query('agentDriveWriteBudgets').collect()) await ctx.db.patch(row._id, { expiresAt: 0 })
  })
  // Cleanup must remain available if the feature is subsequently switched off.
  process.env.OVERLAY_CONNECTED_AGENT_DRIVE = '0'
  const cleanup = await cleanupDriveVersions({
    claim: claim => f.convex.mutation(cleanupClaim, { serverSecret: secret, claim }),
    deleteObject: async key => { objects.delete(key) }, absent: async key => !objects.has(key),
    acknowledge: ({ id, claim }) => {
      const row = queued.find(row => row._id === id)
      if (!row) throw Error('unexpected cleanup ticket')
      return f.convex.mutation(cleanupAck, { serverSecret: secret, id: row._id, claim })
    },
  })
  expect(cleanup).toEqual({ deleted: 3, deferred: 0 })
  expect([...objects]).toEqual([committed.finalKey])
  const canonical = await f.convex.run(ctx => ctx.db.get(result.fileId))
  expect(canonical?.r2Key).toBe(committed.finalKey)
  expect(canonical?.content).toBe('retained canonical bytes')
  expect(await f.convex.run(ctx => ctx.db.query('agentDriveRetiredObjects').collect())).toEqual([])
  expect(await f.convex.run(ctx => ctx.db.query('agentDriveUploads').collect())).toEqual([])
  expect(await f.convex.run(ctx => ctx.db.query('agentDriveWriteBudgets').collect())).toEqual([])
  expect(await f.convex.run(async ctx => (await ctx.db.query('subscriptions').withIndex('by_userId', q => q.eq('userId', 'u')).unique())?.overlayStorageBytesUsed)).toBe(first.sizeBytes)
})

test('metadata receipts retain the complete execution retry window and migrate older records before pruning', async () => {
  const f = await fixture()
  const command = { ...f.args, requestId: 'retained-metadata-001', operation: { kind: 'mkdir', name: 'kept' } }
  const result = await f.convex.mutation(metadataRef, command)
  const receipt = await f.convex.run(ctx => ctx.db.query('agentDriveMetadataReceipts').unique())
  expect(receipt?.retireAt).toBeGreaterThan(f.args.expiresAt + 48 * 60 * 60_000)
  await f.convex.mutation(cleanupClaim, { serverSecret: secret, claim: 'cleanup-live-receipt' })
  expect(await f.convex.mutation(metadataRef, command)).toEqual(result)
  if (!receipt) throw Error('missing receipt')
  await f.convex.run(ctx => ctx.db.patch(receipt._id, { retireAt: undefined }))
  await f.convex.mutation(cleanupClaim, { serverSecret: secret, claim: 'cleanup-legacy-receipt' })
  const migrated = await f.convex.run(ctx => ctx.db.get(receipt._id))
  expect(migrated?.retireAt).toBeGreaterThanOrEqual(receipt.createdAt + 7 * 24 * 60 * 60_000)
  await f.convex.run(ctx => ctx.db.patch(receipt._id, { retireAt: 1 }))
  await f.convex.mutation(cleanupClaim, { serverSecret: secret, claim: 'cleanup-expired-receipt' })
  expect(await f.convex.run(ctx => ctx.db.get(receipt._id))).toBeNull()
  expect(await f.convex.run(ctx => ctx.db.get(result.fileId))).toMatchObject({ name: 'kept', type: 'folder' })
})

test('commit rechecks scope, current attempt, membership and storage quota before publishing a pointer', async () => {
  const f = await fixture()
  const input = writeInput()
  await f.convex.mutation(uploadIntent, { ...f.args, ...input })
  await expect(f.convex.query(uploadRead, { ...f.args, uploadId: input.uploadId, scope: { kind: 'workspace', workspaceId: 'w' } }))
    .rejects.toMatchObject({ data: 'DRIVE_RUN_UNAVAILABLE' })
  const commit = { ...f.args, uploadId: input.uploadId, verifiedSha256: writeHash, verifiedSizeBytes: input.sizeBytes, textPrefix: 'prefix' }
  await expect(f.convex.mutation(uploadCommit, { ...commit, execution: { attemptId: 's', generation: 2 } })).rejects.toMatchObject({ data: 'DRIVE_RUN_UNAVAILABLE' })
  await f.convex.run(ctx => ctx.db.patch(f.ids.membership, { status: 'suspended' }))
  await expect(f.convex.mutation(uploadCommit, commit)).rejects.toMatchObject({ data: 'DRIVE_RUN_UNAVAILABLE' })
  await f.convex.run(async ctx => {
    await ctx.db.patch(f.ids.membership, { status: 'active' })
    const subscription = await ctx.db.query('subscriptions').withIndex('by_userId', q => q.eq('userId', 'u')).unique()
    if (!subscription) throw Error('Expected quota row')
    await ctx.db.patch(subscription._id, { overlayStorageBytesUsed: 1e15 })
  })
  await expect(f.convex.mutation(uploadCommit, commit)).rejects.toMatchObject({ data: 'DRIVE_STORAGE_QUOTA' })
  expect((await f.convex.query(uploadRead, { ...f.args, uploadId: input.uploadId })).state.kind).toBe('pending')
  expect((await f.read()).rows.some(row => row.r2Key?.includes(input.uploadId))).toBe(false)
})

test('note writes preserve full inline Markdown; larger versions become object-backed file copies', async () => {
  const f = await fixture()
  const [note] = (await f.read()).rows
  const text = '# Updated note\n'
  const input = { ...writeInput(), sizeBytes: new TextEncoder().encode(text).length,
    operation: { kind: 'replace', fileId: note._id, path: note.name, updatedAt: note.updatedAt } }
  await f.convex.mutation(uploadIntent, { ...f.args, ...input })
  const result = await f.convex.mutation(uploadCommit, { ...f.args, uploadId: input.uploadId,
    verifiedSha256: writeHash, verifiedSizeBytes: input.sizeBytes, textPrefix: text })
  expect(result).toMatchObject({ fileId: note._id, conflict: false, objectStored: false })
  expect(await f.convex.run(ctx => ctx.db.get(note._id))).toMatchObject({ kind: 'note', content: text, textInObjectStore: false })
  const large = { ...writeInput(2), operation: { kind: 'replace', fileId: note._id, path: note.name, updatedAt: result.updatedAt } }
  await f.convex.mutation(uploadIntent, { ...f.args, ...large })
  const copy = await f.convex.mutation(uploadCommit, { ...f.args, uploadId: large.uploadId,
    verifiedSha256: writeHash, verifiedSizeBytes: large.sizeBytes, textPrefix: 'searchable prefix' })
  expect(copy).toMatchObject({ conflict: true, objectStored: true })
  expect(copy.fileId).not.toBe(note._id)
  expect((await f.convex.run(ctx => ctx.db.get(note._id)))?.content).toBe(text)
})

test('real drive transactions round-trip full object bytes despite staging races and a lost commit acknowledgement', async () => {
  // Reindexing is an external-provider job, outside this storage/synchronization acceptance.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const f = await fixture()
  await f.convex.run(async ctx => {
    await ctx.db.insert('workspaceUserPreferences', { userId: 'u', activeWorkspaceId: 'w', updatedAt: Date.now() })
    await ctx.db.insert('billingAccounts', { billingAccountId: 'drive-paid', workspaceId: 'w', scope: 'workspace', status: 'active',
      pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: Date.now(), updatedAt: Date.now() })
    await ctx.db.insert('billingAccountSubscriptions', { billingAccountId: 'drive-paid', provider: 'stripe', planKind: 'paid',
      planVersion: 'variable_v2', planAmountCents: 2000, markupBasisPoints: 2500, status: 'active', autoTopUpEnabled: false,
      autoTopUpAmountCents: 0, createdAt: Date.now(), updatedAt: Date.now() })
  })
  const signingSecret = secret.padEnd(40, '0')
  const tokens = createAgentDriveTokens({ secret: signingSecret })
  const { serverSecret: _serverSecret, expiresAt, ...claims } = f.args
  const token = tokens.mint(claims, expiresAt)
  const store = new Map<string, Uint8Array>()
  let stagingKey = ''
  let sealedKey = ''
  let seals = 0
  let loseAck = true
  let loseManifest = false
  const authorize = async () => { await f.convex.query(makeFunctionReference<'query'>('agents/agentDrive:authorizeByServer'), f.args) }
  const service = new AgentDriveContentService({ secret: signingSecret, verifyToken: tokens.verify,
    repository: () => ({ authorize,
      intent: async input => driveUploadRecordSchema.parse(await f.convex.mutation(uploadIntent, { ...f.args, ...input })),
      read: async uploadId => driveUploadRecordSchema.parse(await f.convex.query(uploadRead, { ...f.args, uploadId })),
      commit: async input => {
        const result = driveContentResultSchema.parse(await f.convex.mutation(uploadCommit, { ...f.args, ...input }))
        if (loseAck) { loseAck = false; throw Error('simulated lost acknowledgement') }
        return result
      },
    }), storage: {
      checkBudget: async () => {},
      uploadUrl: async (key, _mime, _size, _hash, ttl) => { stagingKey = key; expect(ttl).toBeLessThanOrEqual(120); return 'https://storage.test/staging-only' },
      read: async key => { const bytes = store.get(key)?.slice(); if (!bytes) throw Error('missing staging'); store.set(key, new Uint8Array([255])); return bytes },
      seal: async (key, bytes) => { seals++; sealedKey = key; store.set(key, bytes.slice()) },
    },
  })
  const full = new TextEncoder().encode('🙂 Full canonical deliverable\n'.repeat(50000))
  const sha256 = createHash('sha256').update(full).digest('hex')
  const intent = await service.intent(token, { action: 'upload', requestId: 'real-upload-roundtrip',
    operation: { kind: 'create', name: 'deliverable.txt' }, sizeBytes: full.length, sha256, mimeType: 'text/plain' })
  expect(intent.state).toBe('pending')
  expect(JSON.stringify(intent)).not.toContain('users/u/files/')
  store.set(stagingKey, full)
  await expect(service.commit(token, { action: 'commit', uploadId: intent.uploadId })).rejects.toThrow('lost acknowledgement')
  const result = await service.commit(token, { action: 'commit', uploadId: intent.uploadId })
  expect(result).toMatchObject({ conflict: false, objectStored: true, sha256, sizeBytes: full.length })
  expect(seals).toBe(1)
  expect(Buffer.from(store.get(sealedKey) ?? []).equals(Buffer.from(full))).toBe(true)
  const file = await f.convex.run(ctx => ctx.db.get(result.fileId))
  expect(new TextEncoder().encode(file?.content).length).toBeLessThan(full.length)
  expect(file?.textInObjectStore).toBe(true)
  // A fresh reader uses the actual Files pointer, never the searchable prefix.
  const reader = new AgentDriveManifestService({ secret: signingSecret, verifyToken: tokens.verify,
    repository: () => ({ authorize, page: async cursor => f.read(cursor === null ? {} : { cursor }),
      file: async (fileId, updatedAt) => f.convex.query(makeFunctionReference<'query'>('agents/agentDrive:fileByServer'), { ...f.args, fileId, updatedAt }),
      metadata: async (requestId, operation) => f.convex.mutation(metadataRef, { ...f.args, requestId, operation }),
    }), materializer: () => new AgentDriveMaterializer({
      size: async source => source.kind === 'object' ? store.get(source.key)?.length ?? 0 : 0,
      read: async source => { if (source.kind !== 'object') throw Error('expected canonical object'); return store.get(source.key)?.slice() ?? new Uint8Array() },
    }),
  })
  const entry = (await reader.manifest(token)).entries.find(entry => entry.fileId === result.fileId)
  if (!entry?.downloadMac) throw Error('Expected ready download')
  const { downloadMac, ...downloadEntry } = entry
  expect(Buffer.from(await reader.download(token, { entry: downloadEntry, downloadMac })).equals(Buffer.from(full))).toBe(true)
  // The packaged host client crosses the actual BFF request handler and current
  // Convex-backed readers, including range reconstruction beyond the row prefix.
  const host = new AgentDriveClient({ apiUrl: 'https://preview.invalid/api/agent-drive',
    credentials: async () => ({ protocolVersion: 1, token, expiresAt, scope: claims.scope }),
    fetch: async (input, init) => {
      if (String(input) === 'https://storage.test/staging-only') {
        store.set(stagingKey, new Uint8Array(await new Response(init?.body).arrayBuffer()))
        return new Response(null)
      }
      if (loseManifest && JSON.parse(String(init?.body)).action === 'manifest') {
        loseManifest = false
        throw Error('simulated manifest response loss')
      }
      return handleAgentDriveRequest(new Request(input, init), {
        enabled: () => true, service: () => reader, writes: () => service, limit: async () => null,
      })
    },
  })
  const hydrated = (await host.manifest()).find(item => item.fileId === result.fileId)
  if (!hydrated || hydrated.kind !== 'file' || hydrated.hydration !== 'ready') throw Error('Expected ready Files manifest entry')
  expect(Buffer.from(await host.download(hydrated)).equals(Buffer.from(full))).toBe(true)
  expect(await host.commit(intent.uploadId)).toEqual(result)
  expect(seals).toBe(1)
  // Exercise a real host restart after Files committed but the BFF could not acknowledge it.
  const directory = mkdtempSync(join(tmpdir(), 'drive-convex-journal-'))
  const journalPath = join(directory, 'drive.sqlite')
  const context = { environmentId: claims.environmentId, runId: claims.runId, sessionId: claims.sessionId,
    scope: claims.scope, execution: claims.execution }
  let journal = new SqliteDriveJournal(journalPath, context)
  try {
    loseAck = true
    const durableRequest = { action: 'upload' as const, requestId: 'durable-upload-roundtrip',
      operation: { kind: 'create' as const, name: 'durable.txt' }, sizeBytes: full.length, sha256, mimeType: 'text/plain' }
    await expect(new AgentDriveWriter(journal, host).content(durableRequest, full)).rejects.toThrow()
    expect(journal.pending()[0]?.phase.kind).toBe('committing')
    journal.close()
    journal = new SqliteDriveJournal(journalPath, context)
    const receipts = await new AgentDriveWriter(journal, host).flush()
    const receipt = receipts[0]
    if (!receipt || receipt.kind !== 'content') throw Error('Expected durable content receipt')
    expect(journal.pending()).toEqual([])
    expect(seals).toBe(2)
    const rows = await f.convex.run(ctx => ctx.db.query('files').filter(q => q.eq(q.field('name'), 'durable.txt')).collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]?._id).toBe(receipt.result.fileId)
    const restored = (await host.manifest()).find(item => item.fileId === receipt.result.fileId)
    if (!restored || restored.kind !== 'file' || restored.hydration !== 'ready') throw Error('Expected durable Files entry')
    expect(createHash('sha256').update(await host.download(restored)).digest('hex')).toBe(sha256)
  } finally { journal.close(); rmSync(directory, { recursive: true, force: true }) }

  const syncDirectory = mkdtempSync(join(tmpdir(), 'drive-sync-convex-'))
  const cache = await AgentDriveCache.create(syncDirectory, 'drive')
  let syncJournal = new SqliteDriveJournal(join(syncDirectory, 'writes.sqlite'), context)
  let syncState = new SqliteDriveSyncState(join(syncDirectory, 'baseline.sqlite'), cache.root, claims.scope)
  try {
    let sync = new AgentDriveSynchronizer({ runId: claims.runId, cache, journal: syncJournal, state: syncState, client: host })
    await sync.initialize()
    expect(createHash('sha256').update(readFileSync(join(cache.root, 'durable.txt'))).digest('hex')).toBe(sha256)
    mkdirSync(join(cache.root, 'Research', 'Empty'), { recursive: true })
    writeFileSync(join(cache.root, 'Research', 'report.md'), full)
    const saved = await sync.sync(true)
    expect(saved.some(item => item.path === 'Research/report.md')).toBe(true)
    expect(saved.some(item => item.path === 'Research/Empty')).toBe(true)
    const original = (await host.manifest()).find(item => item.path === 'Research/report.md')
    expect(original?.kind).toBe('file')
    // Editors commonly replace an inode atomically even when the resulting bytes match.
    writeFileSync(join(cache.root, 'Research', 'replacement.tmp'), full)
    renameSync(join(cache.root, 'Research', 'replacement.tmp'), join(cache.root, 'Research', 'report.md'))
    await sync.sync(true)
    renameSync(join(cache.root, 'Research', 'report.md'), join(cache.root, 'Research', 'draft.md'))
    await sync.sync(true)
    expect((await host.manifest()).find(item => item.path === 'Research/draft.md')?.fileId).toBe(original?.fileId)
    renameSync(join(cache.root, 'Research', 'draft.md'), join(cache.root, 'Research', 'report.md'))
    await sync.sync(true)
    renameSync(join(cache.root, 'Research'), join(cache.root, 'Renamed'))
    const edited = Buffer.from('Full updated report\n'.repeat(45000))
    writeFileSync(join(cache.root, 'Renamed', 'report.md'), edited)
    await sync.sync(true)
    const moved = (await host.manifest()).find(item => item.path === 'Renamed/report.md')
    if (!moved || moved.kind !== 'file' || moved.hydration !== 'ready') throw Error('Expected synced renamed report')
    expect(moved.fileId).toBe(original?.fileId)
    expect(createHash('sha256').update(await host.download(moved)).digest('hex')).toBe(createHash('sha256').update(edited).digest('hex'))
    const freshCache = await AgentDriveCache.create(syncDirectory, 'fresh-drive')
    const freshJournal = new SqliteDriveJournal(join(syncDirectory, 'fresh-writes.sqlite'), context)
    const freshState = new SqliteDriveSyncState(join(syncDirectory, 'fresh-baseline.sqlite'), freshCache.root, claims.scope)
    try {
      await new AgentDriveSynchronizer({ runId: claims.runId, cache: freshCache, journal: freshJournal, state: freshState, client: host }).initialize()
      expect(readFileSync(join(freshCache.root, 'Renamed', 'report.md')).equals(edited)).toBe(true)
      expect((await freshCache.inventory()).some(item => item.kind === 'folder' && item.path === 'Renamed/Empty')).toBe(true)
    } finally { freshJournal.close(); freshState.close() }
    writeFileSync(join(cache.root, 'recovered.txt'), full)
    loseAck = true
    await expect(sync.sync(true)).rejects.toThrow()
    expect(syncState.read().phase).toBe('writing')
    expect(syncJournal.pending()[0]?.phase.kind).toBe('committing')
    syncJournal.close(); syncState.close()
    syncJournal = new SqliteDriveJournal(join(syncDirectory, 'writes.sqlite'), context)
    syncState = new SqliteDriveSyncState(join(syncDirectory, 'baseline.sqlite'), cache.root, claims.scope)
    sync = new AgentDriveSynchronizer({ runId: claims.runId, cache, journal: syncJournal, state: syncState, client: host })
    await sync.initialize()
    const recoveredSaved = await sync.sync(true)
    expect(recoveredSaved.some(item => item.path === 'recovered.txt')).toBe(true)
    expect(recoveredSaved.some(item => item.path === 'Renamed/report.md')).toBe(true)
    expect((await host.manifest()).filter(item => item.path === 'recovered.txt')).toHaveLength(1)
    expect(syncJournal.pending()).toEqual([])
    writeFileSync(join(cache.root, 'acknowledged.txt'), full)
    loseManifest = true
    await expect(sync.sync(true)).rejects.toThrow('manifest response loss')
    const applying = syncState.read()
    if (applying.phase !== 'writing') throw Error('Expected persisted unreconciled effect')
    expect(syncJournal.find(applying.operation.request.requestId)?.phase.kind).toBe('committed')
    // The server write was confirmed, but local reconciliation failed: completion still failed.
    syncJournal.close(); syncState.close()
    syncJournal = new SqliteDriveJournal(join(syncDirectory, 'writes.sqlite'), context)
    syncState = new SqliteDriveSyncState(join(syncDirectory, 'baseline.sqlite'), cache.root, claims.scope)
    sync = new AgentDriveSynchronizer({ runId: claims.runId, cache, journal: syncJournal, state: syncState, client: host })
    await sync.initialize()
    expect((await host.manifest()).filter(item => item.path === 'acknowledged.txt')).toHaveLength(1)
    expect(syncState.read().phase).toBe('idle')
    // Another writer advances the canonical revision after this cache read it.
    const otherBytes = Buffer.from('Newer canonical version\n'.repeat(40000))
    const otherHash = createHash('sha256').update(otherBytes).digest('hex')
    const otherIntent = await host.intent({ action: 'upload', requestId: 'other-writer-version-001',
      operation: { kind: 'replace', entry: { fileId: moved.fileId, path: moved.path, kind: moved.kind, updatedAt: moved.updatedAt }, metadataMac: moved.metadataMac },
      sizeBytes: otherBytes.length, sha256: otherHash, mimeType: 'text/plain' })
    if (otherIntent.state !== 'pending') throw Error('Expected another writer upload')
    await host.upload(otherIntent, otherBytes, otherHash)
    await host.commit(otherIntent.uploadId)
    const ownBytes = Buffer.from('Concurrent agent deliverable\n'.repeat(40000))
    writeFileSync(join(cache.root, 'Renamed', 'report.md'), ownBytes)
    await sync.sync(true)
    const conflicts = (await host.manifest()).filter(item => item.path.startsWith('Renamed/report'))
    expect(conflicts.map(item => item.path).sort()).toEqual(['Renamed/report (agent).md', 'Renamed/report.md'])
    const own = conflicts.find(item => item.path === 'Renamed/report (agent).md')
    if (!own || own.kind !== 'file' || own.hydration !== 'ready') throw Error('Expected complete conflict copy')
    expect(Buffer.from(await host.download(own)).equals(ownBytes)).toBe(true)
    // Bootstrap normalizes the local alias before hydrating the newer canonical file.
    await sync.initialize()
    expect(readFileSync(join(cache.root, 'Renamed', 'report.md')).equals(otherBytes)).toBe(true)
    expect(readFileSync(join(cache.root, 'Renamed', 'report (agent).md')).equals(ownBytes)).toBe(true)
    unlinkSync(join(cache.root, 'Renamed', 'report.md'))
    unlinkSync(join(cache.root, 'Renamed', 'report (agent).md'))
    rmdirSync(join(cache.root, 'Renamed', 'Empty'))
    rmdirSync(join(cache.root, 'Renamed'))
    await sync.sync(true)
    expect((await host.manifest()).some(item => item.path.startsWith('Renamed'))).toBe(false)
  } finally { syncJournal.close(); syncState.close(); rmSync(syncDirectory, { recursive: true, force: true }) }
}, 20000)
