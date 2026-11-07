import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const fn = {
  mentions: makeFunctionReference<'query'>('search/browse:mentions'),
  children: makeFunctionReference<'query'>('files/browse:children'),
}
const backendUrl = 'https://fixture.convex.cloud'

afterEach(() => { vi.unstubAllEnvs() })

type Mentions = {
  chats: Array<{ title: string }>
  files: Array<{ name: string; kind?: string }>
  skills: Array<{ name: string }>
  automations: Array<{ name?: string }>
  mcpServers: Array<{ name: string }>
  connectorsAllowed: boolean
}

async function fixture() {
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', backendUrl)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'test')
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('nativeDeploymentPolicies', {
      key: 'web', sequence: 1, challenge: 'c', sourceOrigin: 'https://app.example.test', expiresAt: Date.now() + 600_000,
      snapshot: {
        version: 1, backendUrl, revision: 'a'.repeat(64),
        features: { files: true, skills: true, mcpServers: true, automations: true, integrations: true },
        rollout: { stage: 'general', internalWorkspaceIds: '', invitedWorkspaceIds: '' },
      },
    } as never)
    await ctx.db.insert('authorizationRoles', {
      roleId: 'everything', name: 'All', isSystem: false, createdAt: 1, updatedAt: 1,
      capabilities: ['conversations.read', 'files.read', 'skills.use', 'mcp.use', 'automations.use', 'integrations.use'],
    })
    await ctx.db.insert('authorizationRoles', { roleId: 'files-only', name: 'Files', capabilities: ['files.read'], isSystem: false, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const [userId, roleId] of [['alice', 'everything'], ['bob', 'everything'], ['carol', 'files-only']] as const) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
      await ctx.db.insert('authorizationUserRoles', { roleId, userId, createdAt: 1 })
    }
    const file = (fields: Record<string, unknown>) => ctx.db.insert('files', {
      workspaceId: 'ws', userId: 'alice', type: 'file', kind: 'upload', createdAt: 1, updatedAt: 1, ...fields,
    } as never)
    const folder = await file({ name: 'Roadmap folder', type: 'folder', kind: 'folder', scope: 'workspace' })
    await file({ name: 'Roadmap private.md' })
    await file({ name: 'Roadmap shared.md', scope: 'workspace', parentId: folder })
    await file({ name: 'Roadmap note', kind: 'note', scope: 'workspace' })
    await file({ name: 'Roadmap archived.md', scope: 'workspace', archivedAt: 5 })
    await file({ name: 'Roadmap deleted.md', scope: 'workspace', deletedAt: 5 })
    const skill = (name: string, fields: Record<string, unknown> = {}) => ctx.db.insert('skills', {
      workspaceId: 'ws', userId: 'alice', name, description: 'd', instructions: 'i', createdAt: 1, updatedAt: 1, ...fields,
    } as never)
    await skill('Roadmap skill shared', { scope: 'workspace' })
    await skill('Roadmap skill private')
    await skill('Roadmap skill off', { scope: 'workspace', enabled: false })
    await skill('Release helper', { description: 'deploys the roadmap build' })
    await ctx.db.insert('mcpServers', {
      workspaceId: 'ws', userId: 'alice', name: 'Roadmap server', description: 'tools', url: 'https://mcp.example/secret-path', transport: 'streamable-http',
      enabled: true, authType: 'none', scope: 'workspace', createdAt: 1, updatedAt: 1,
    } as never)
    const chat = { workspaceId: 'ws', userId: 'alice', createdAt: 1, updatedAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'm' }
    await ctx.db.insert('conversations', { ...chat, title: 'Roadmap chat', lastModified: 1 } as never)
    await ctx.db.insert('conversations', { ...chat, title: 'Roadmap automation chat', isAutomation: true, lastModified: 2 } as never)
    // A channel Bob created that Alice joined, one she archived, and one she is not in.
    const room = (title: string, extra: Record<string, unknown> = {}) => ctx.db.insert('conversations', {
      ...chat, userId: 'bob', title, conversationType: 'channel', scope: 'workspace', lastModified: 3, ...extra,
    } as never)
    const join = (conversationId: Awaited<ReturnType<typeof room>>, principalId: string, extra: Record<string, unknown> = {}) => ctx.db.insert('conversationParticipants', {
      conversationId, workspaceId: 'ws', principalId, principalType: 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1, ...extra,
    } as never)
    const joined = await room('Roadmap channel')
    await join(joined, 'p-alice'); await join(joined, 'p-bob')
    await join(await room('Roadmap archived channel'), 'p-alice', { archivedAt: 4 })
    await join(await room('Roadmap private channel'), 'p-bob')
    return folder
  })
  return { t, as: (subject: string) => t.withIdentity({ subject }) }
}

test('mentions search own and workspace-shared items, never archived, deleted, disabled, folders or automation chats', async () => {
  const { as } = await fixture()
  const alice = await as('alice').query(fn.mentions, { workspaceId: 'ws', query: 'roadmap' }) as Mentions
  expect(alice.files.map(f => f.name).sort()).toEqual(['Roadmap note', 'Roadmap private.md', 'Roadmap shared.md'])
  expect(alice.files.find(f => f.name === 'Roadmap note')?.kind).toBe('note')
  expect(alice.skills.map(s => s.name).sort()).toEqual(['Release helper', 'Roadmap skill private', 'Roadmap skill shared'])
  expect(alice.chats.map(c => c.title).sort()).toEqual(['Roadmap channel', 'Roadmap chat'])
  // Skills match on description too, after name matches.
  expect(alice.skills.map(s => s.name)).toContain('Release helper')
  expect(alice.mcpServers.map(s => s.name)).toEqual(['Roadmap server'])
  expect(JSON.stringify(alice)).not.toMatch(/secret-path|https:/)

  // Bob sees what Alice shared, not her private items or her chats.
  const bob = await as('bob').query(fn.mentions, { workspaceId: 'ws', query: 'roadmap' }) as Mentions
  expect(bob.files.map(f => f.name).sort()).toEqual(['Roadmap note', 'Roadmap shared.md'])
  expect(bob.skills.map(s => s.name)).toEqual(['Roadmap skill shared'])
  expect(bob.chats.map(c => c.title).sort()).toEqual(['Roadmap channel', 'Roadmap private channel'])
})

test('each category needs its capability; strangers get nothing; an empty query lists the newest', async () => {
  const { as } = await fixture()
  const carol = await as('carol').query(fn.mentions, { workspaceId: 'ws', query: 'roadmap' }) as Mentions
  expect(carol.files.map(f => f.name).sort()).toEqual(['Roadmap note', 'Roadmap shared.md'])
  expect([carol.skills, carol.mcpServers, carol.automations, carol.chats]).toEqual([[], [], [], []])
  expect(carol.connectorsAllowed).toBe(false)
  expect(await as('stranger').query(fn.mentions, { workspaceId: 'ws', query: 'roadmap' })).toBeNull()
  const recent = await as('alice').query(fn.mentions, { workspaceId: 'ws', query: '' }) as Mentions
  expect(recent.files.length).toBeGreaterThan(0)
  expect(recent.connectorsAllowed).toBe(true)
})

test('folder children resolve links with the tree read rules', async () => {
  const { t, as } = await fixture()
  const folder = await t.run(async ctx => (await ctx.db.query('files').collect()).find(row => row.kind === 'folder')!._id)
  type Listing = { files: Array<{ name: string }>; complete: boolean }
  const inFolder = await as('bob').query(fn.children, { workspaceId: 'ws', parentId: folder, view: 'workspace' }) as Listing
  expect(inFolder.files.map(row => row.name)).toEqual(['Roadmap shared.md'])
  expect(inFolder.complete).toBe(true)
  const root = await as('bob').query(fn.children, { workspaceId: 'ws', parentId: null, view: 'workspace' }) as Listing
  expect(root.files.map(row => row.name).sort()).toEqual(['Roadmap folder', 'Roadmap note'])
  expect(await as('stranger').query(fn.children, { workspaceId: 'ws', parentId: null, view: 'workspace' })).toBeNull()
})

test('a folder with more children than one read is reported incomplete', async () => {
  const { t, as } = await fixture()
  await t.run(async ctx => {
    for (let i = 0; i < 501; i++) {
      await ctx.db.insert('files', { workspaceId: 'ws', userId: 'alice', type: 'file', kind: 'upload', name: `bulk-${i}`, scope: 'workspace', createdAt: 1, updatedAt: 1 } as never)
    }
  })
  const root = await as('bob').query(fn.children, { workspaceId: 'ws', parentId: null, view: 'workspace' }) as { complete: boolean }
  expect(root.complete).toBe(false)
})
