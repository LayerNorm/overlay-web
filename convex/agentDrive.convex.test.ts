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
