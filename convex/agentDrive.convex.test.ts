import { beforeEach, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-drive-convex-tests-only'
const readRef = makeFunctionReference<'query'>('agents/agentDrive:manifestPageByServer')
beforeEach(() => { process.env.INTERNAL_API_SECRET = secret; process.env.OVERLAY_CONNECTED_AGENT_DRIVE = '1' })

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
  const move = { ...f.args, requestId: 'move-folder-00001', operation: { kind: 'move', fileId: folder.fileId, updatedAt: folder.updatedAt, name: 'renamed' } }
  const moved = await f.convex.mutation(metadataRef, move)
  expect(moved.fileId).toBe(folder.fileId)
  expect(moved.updatedAt).toBeGreaterThan(folder.updatedAt)
  expect(await f.convex.mutation(metadataRef, move)).toEqual(moved)
  await expect(f.convex.mutation(metadataRef, { ...move, requestId: 'stale-move-000001' })).rejects.toMatchObject({ data: 'DRIVE_SOURCE_CHANGED' })
  const removed = await f.convex.mutation(metadataRef, { ...f.args, requestId: 'remove-folder-001', operation: { kind: 'remove', fileId: moved.fileId, updatedAt: moved.updatedAt } })
  expect(removed.updatedAt).toBeGreaterThan(moved.updatedAt)
  expect((await f.convex.run(ctx => ctx.db.get(moved.fileId)))?.deletedAt).toBe(removed.updatedAt)
})

test('metadata writes reject unsafe paths, collisions, cycles and cross-scope parents', async () => {
  const f = await fixture()
  const create = (name: string, requestId: string, parentId?: string) => f.convex.mutation(metadataRef, { ...f.args, requestId, operation: { kind: 'mkdir', name, ...(parentId ? { parentId } : {}) } })
  for (const name of ['..', 'a/b', 'a\\b', 'x\u0000']) await expect(create(name, 'unsafe-path-00001')).rejects.toMatchObject({ data: 'DRIVE_UNSAFE_PATH' })
  const folder = await create('folder', 'safe-folder-00001')
  await expect(create('folder', 'collision-000001')).rejects.toMatchObject({ data: 'DRIVE_PATH_CONFLICT' })
  await expect(f.convex.mutation(metadataRef, { ...f.args, requestId: 'parent-cycle-001', operation: { kind: 'move', fileId: folder.fileId, updatedAt: folder.updatedAt, name: 'folder', parentId: folder.fileId } })).rejects.toMatchObject({ data: 'DRIVE_UNSAFE_PATH' })
  const foreign = await f.convex.run(ctx => ctx.db.insert('files', { workspaceId: 'foreign', userId: 'u', name: 'foreign', type: 'folder', kind: 'folder', createdAt: 1, updatedAt: 1 }))
  await expect(create('child', 'foreign-parent-01', foreign)).rejects.toMatchObject({ data: 'DRIVE_EDIT_DENIED' })
})

test('a folder deletion cannot implicitly remove an unhydrated remote child', async () => {
  const f = await fixture()
  const folder = await f.convex.mutation(metadataRef, { ...f.args, requestId: 'folder-delete-001', operation: { kind: 'mkdir', name: 'folder' } })
  await f.convex.run(ctx => ctx.db.insert('files', { userId: 'u', workspaceId: 'w', name: 'unhydrated.bin', parentId: folder.fileId, type: 'file', kind: 'upload', createdAt: 1, updatedAt: 1 }))
  await expect(f.convex.mutation(metadataRef, { ...f.args, requestId: 'delete-parent-01', operation: { kind: 'remove', fileId: folder.fileId, updatedAt: folder.updatedAt } })).rejects.toMatchObject({ data: 'DRIVE_DIRECTORY_NOT_EMPTY' })
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
  await expect(f.convex.mutation(metadataRef, { ...f.args, scope: { kind: 'workspace', workspaceId: 'w' }, requestId: 'readonly-move-01', operation: { kind: 'move', fileId: row._id, updatedAt: row.updatedAt, name: 'stolen.md' } })).rejects.toMatchObject({ data: 'DRIVE_EDIT_DENIED' })
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
    const args = { ...f.args, requestId, operation: { kind: 'remove', fileId, updatedAt: 1 } }
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
