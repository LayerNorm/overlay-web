import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'resource-scope-secret'
const now = 1_900_000_000_000
const workspaceId = 'ws-scope'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const q = (name: string) => makeFunctionReference<'query'>(name)
const m = (name: string) => makeFunctionReference<'mutation'>(name)

type Convex = ReturnType<typeof convexTest>

/** A workspace with an owner, an admin, two members, and a guest. */
async function seed(convex: Convex, policy?: Record<string, unknown>) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', { workspaceId, kind: 'organization', name: 'Scope', slug: 'scope', status: 'active', createdAt: now, updatedAt: now })
    for (const [userId, role] of [['owner', 'owner'], ['admin', 'admin'], ['alice', 'member'], ['bob', 'member'], ['gus', 'guest']] as const) {
      await ctx.db.insert('workspacePrincipals', { principalId: `p-${userId}`, workspaceId, type: 'human', userId, displayName: userId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { membershipId: `m-${userId}`, workspaceId, principalId: `p-${userId}`, role, status: 'active', joinedAt: now, updatedAt: now })
    }
    if (policy) await ctx.db.insert('workspaceSharingPolicies', { workspaceId, publicLinksEnabled: true, createdAt: now, updatedAt: now, ...policy })
  })
}

const auth = { serverSecret: secret, workspaceId }

describe('skills (an extension resource)', () => {
  test('personal is private; moving to workspace shares it; archive and restore round-trip; only the creator moves it', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const skillId = await convex.mutation(m('integrations/skills:create'), { ...auth, userId: 'alice', name: 'Brief', description: 'd', instructions: 'i' }) as string
    const names = async (userId: string, view?: string) =>
      ((await convex.query(q('integrations/skills:list'), { ...auth, userId, ...(view ? { view } : {}) })) as Array<{ name: string }>).map((s) => s.name)

    expect(await names('alice')).toEqual(['Brief'])
    expect(await names('bob')).toEqual([])
    expect(await names('owner')).toEqual([])

    const move = (userId: string, to: 'personal' | 'workspace') => convex.mutation(m('integrations/skills:setScope'), { ...auth, userId, id: skillId, to })
    expect(await move('bob', 'workspace')).toEqual({ ok: false, reason: 'not_found' })
    expect(await move('alice', 'workspace')).toEqual({ ok: true })
    expect(await names('bob')).toEqual(['Brief'])
    expect(await names('bob', 'workspace')).toEqual(['Brief'])
    expect(await names('alice', 'personal')).toEqual([])
    expect(await names('gus')).toEqual([])
    expect(await move('admin', 'personal')).toEqual({ ok: false, reason: 'not_creator' })
    expect(await move('alice', 'workspace')).toEqual({ ok: false, reason: 'same_scope' })

    // An admin may archive someone else's workspace item; it leaves the workspace view and shows under Archived to members.
    expect(await convex.mutation(m('integrations/skills:archive'), { ...auth, userId: 'admin', id: skillId })).toEqual({ ok: true })
    expect(await names('bob')).toEqual([])
    expect(await names('bob', 'archived')).toEqual(['Brief'])
    expect(await move('alice', 'personal')).toEqual({ ok: false, reason: 'archived' })
    expect(await convex.mutation(m('integrations/skills:restore'), { ...auth, userId: 'alice', id: skillId })).toEqual({ ok: true })
    expect(await names('bob', 'workspace')).toEqual(['Brief'])
  })

  test('a member cannot edit or delete another member\'s workspace skill; an admin can edit it', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const skillId = await convex.mutation(m('integrations/skills:create'), { ...auth, userId: 'alice', name: 'Shared', description: 'd', instructions: 'i', scope: 'workspace' }) as string
    await expect(convex.mutation(m('integrations/skills:update'), { ...auth, userId: 'bob', skillId, name: 'Hacked' })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(m('integrations/skills:remove'), { ...auth, userId: 'bob', skillId })).rejects.toThrow(/Unauthorized/)
    await convex.mutation(m('integrations/skills:update'), { ...auth, userId: 'admin', skillId, name: 'Renamed' })
    const read = await convex.query(q('integrations/skills:get'), { ...auth, userId: 'bob', skillId }) as { name: string } | null
    expect(read?.name).toBe('Renamed')
    expect(await convex.query(q('integrations/skills:get'), { ...auth, userId: 'gus', skillId })).toBeNull()
  })

  test('the admin settings govern creating in the workspace, per kind, and moving between scopes', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex, { workspaceExtensionsEditors: 'admins', workspaceContentEditors: 'members', memberCanMoveScope: false })
    // Extensions: members cannot create in the workspace, admins can.
    await expect(convex.mutation(m('integrations/skills:create'), { ...auth, userId: 'alice', name: 'x', description: 'd', instructions: 'i', scope: 'workspace' })).rejects.toThrow(/workspace_creation_restricted/)
    await convex.mutation(m('integrations/skills:create'), { ...auth, userId: 'admin', name: 'Admin skill', description: 'd', instructions: 'i', scope: 'workspace' })
    // Content (automations) stays open to members.
    await convex.mutation(m('automations/automations:create'), {
      ...auth, userId: 'alice', name: 'Daily', instructions: 'do it', enabled: false, schedule: { kind: 'daily', hourUTC: 9, minuteUTC: 0 }, scope: 'workspace',
    })
    // Moving is switched off for members, not for admins (their own items).
    const own = await convex.mutation(m('integrations/skills:create'), { ...auth, userId: 'alice', name: 'Mine', description: 'd', instructions: 'i' }) as string
    expect(await convex.mutation(m('integrations/skills:setScope'), { ...auth, userId: 'alice', id: own, to: 'workspace' })).toEqual({ ok: false, reason: 'move_disabled' })
    const adminsOwn = await convex.mutation(m('integrations/skills:create'), { ...auth, userId: 'admin', name: 'Admin personal', description: 'd', instructions: 'i' }) as string
    expect(await convex.mutation(m('integrations/skills:setScope'), { ...auth, userId: 'admin', id: adminsOwn, to: 'workspace' })).toEqual({ ok: true })
  })
})

describe('automations', () => {
  test('archiving stops an automation from running, and it appears under Archived for everyone who could see it', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    // Enabled automations need a paid plan to create through the mutation, so seed the row directly.
    const id = await convex.run(async (ctx) => await ctx.db.insert('automations', {
      userId: 'alice', workspaceId, scope: 'workspace', name: 'Hourly', instructions: 'go', enabled: true,
      schedule: { kind: 'interval', intervalMinutes: 60 }, nextRunAt: now + 1000, createdAt: now, updatedAt: now,
    } as never)) as string
    const list = async (userId: string, view?: string) =>
      ((await convex.query(q('automations/automations:list'), { ...auth, userId, ...(view ? { view } : {}) })) as Array<{ name: string }>).map((a) => a.name)
    expect(await list('bob', 'workspace')).toEqual(['Hourly'])
    expect(await convex.mutation(m('automations/automations:archive'), { ...auth, userId: 'alice', id })).toEqual({ ok: true })
    const row = await convex.run(async (ctx) => await ctx.db.get(id as never)) as { enabled?: boolean; nextRunAt?: number; archivedFromScope?: string }
    expect(row.enabled).toBe(false)
    expect(row.nextRunAt).toBeUndefined()
    expect(row.archivedFromScope).toBe('workspace')
    expect(await list('bob', 'workspace')).toEqual([])
    expect(await list('bob', 'archived')).toEqual(['Hourly'])
    expect(await list('alice')).toEqual([])
  })
})

describe('files (notes, uploads, outputs, folders)', () => {
  test('a note is private until moved; a folder takes its contents with it; archived items stay out of the default list', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const create = (userId: string, args: Record<string, unknown>) => convex.mutation(m('files/files:create'), { ...auth, userId, ...args }) as Promise<string>
    const folder = await create('alice', { name: 'Plans', type: 'folder', kind: 'folder' })
    const note = await create('alice', { name: 'Roadmap', kind: 'note', content: '# Roadmap', parentId: folder })
    const names = async (userId: string, view?: string) =>
      ((await convex.query(q('files/files:list'), { ...auth, userId, ...(view ? { view } : {}) })) as Array<{ name: string }>).map((f) => f.name).sort()

    expect(await names('bob')).toEqual([])
    expect(await convex.mutation(m('files/files:setScope'), { ...auth, userId: 'alice', id: folder, to: 'workspace' })).toEqual({ ok: true })
    expect(await names('bob', 'workspace')).toEqual(['Plans', 'Roadmap'])
    const fetched = await convex.query(q('files/files:get'), { ...auth, userId: 'bob', fileId: note }) as { name: string } | null
    expect(fetched?.name).toBe('Roadmap')
    expect(await convex.query(q('files/files:get'), { ...auth, userId: 'gus', fileId: note })).toBeNull()

    expect(await convex.mutation(m('files/files:archive'), { ...auth, userId: 'alice', id: folder })).toEqual({ ok: true })
    expect(await names('bob')).toEqual([])
    expect(await names('bob', 'archived')).toEqual(['Plans', 'Roadmap'])
    expect(await convex.mutation(m('files/files:restore'), { ...auth, userId: 'alice', id: folder })).toEqual({ ok: true })
    expect(await names('bob', 'workspace')).toEqual(['Plans', 'Roadmap'])

    // The paged list follows the same views.
    const page = await convex.query(q('files/files:listPage'), { ...auth, userId: 'bob', view: 'workspace' }) as { data: Array<{ name: string }> }
    expect(page.data.map((f) => f.name).sort()).toEqual(['Plans', 'Roadmap'])
    const personalPage = await convex.query(q('files/files:listPage'), { ...auth, userId: 'bob', view: 'personal' }) as { data: unknown[] }
    expect(personalPage.data).toEqual([])
  })

  test('an owner can remove a member\'s workspace file; a member cannot remove another member\'s', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const id = await convex.mutation(m('files/files:create'), { ...auth, userId: 'alice', name: 'Note', kind: 'note', content: 'x', scope: 'workspace' }) as string
    await expect(convex.mutation(m('files/files:remove'), { ...auth, userId: 'bob', fileId: id })).rejects.toThrow(/Unauthorized/)
    await convex.mutation(m('files/files:remove'), { ...auth, userId: 'owner', fileId: id })
    expect(await convex.query(q('files/files:get'), { ...auth, userId: 'alice', fileId: id })).toBeNull()
  })
})

describe('MCP servers and connectors', () => {
  test('a shared MCP server is listed without credentials and cannot be read in full by another member', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const id = await convex.mutation(m('integrations/mcpServers:create'), {
      ...auth, userId: 'alice', name: 'Docs', transport: 'streamable-http', url: 'https://example.com/mcp', authType: 'bearer', authConfig: { bearerToken: 'sekrit' }, scope: 'workspace',
    }) as string
    const listed = await convex.query(q('integrations/mcpServers:list'), { ...auth, userId: 'bob' }) as Array<Record<string, unknown>>
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ name: 'Docs', scope: 'workspace', hasAuth: true })
    expect(JSON.stringify(listed)).not.toContain('sekrit')
    expect(await convex.query(q('integrations/mcpServers:get'), { ...auth, userId: 'bob', mcpServerId: id })).toBeNull()
    // Archiving also stops agents being offered it.
    await convex.mutation(m('integrations/mcpServers:archive'), { ...auth, userId: 'alice', id })
    expect(await convex.query(q('integrations/mcpServers:listEnabled'), { ...auth, userId: 'alice' })).toEqual([])
  })

  test('another member\'s workspace connector is listed without its account id', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    await convex.mutation(m('integrations/workspaceConnectors:insert'), { workspaceId, userId: 'alice', providerKey: 'gmail', connectedAccountId: 'acct-secret', serverSecret: secret, scope: 'workspace' })
    const seenByBob = await convex.query(q('integrations/workspaceConnectors:listScopedByWorkspace'), { workspaceId, userId: 'bob', serverSecret: secret, view: 'workspace' }) as Array<Record<string, unknown>>
    expect(seenByBob).toHaveLength(1)
    expect(seenByBob[0]).toMatchObject({ providerKey: 'gmail', scope: 'workspace' })
    expect(seenByBob[0]).not.toHaveProperty('connectedAccountId')
    const seenByAlice = await convex.query(q('integrations/workspaceConnectors:listScopedByWorkspace'), { workspaceId, userId: 'alice', serverSecret: secret }) as Array<Record<string, unknown>>
    expect(seenByAlice[0]).toHaveProperty('connectedAccountId', 'acct-secret')
  })
})

describe('memories', () => {
  test('the workspace memory list leaves out other people\'s owner-only memories', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    await convex.run(async (ctx) => {
      await ctx.db.insert('memories', { userId: 'alice', workspaceId, content: 'private', source: 'manual', visibility: 'owner', createdAt: now } as never)
      await ctx.db.insert('memories', { userId: 'alice', workspaceId, content: 'shared', source: 'manual', visibility: 'workspace', createdAt: now } as never)
      await ctx.db.insert('memories', { userId: 'alice', workspaceId, content: 'legacy', source: 'manual', createdAt: now } as never)
    })
    const contents = async (viewerUserId?: string) =>
      ((await convex.query(q('knowledge/memories:listWorkspace'), { serverSecret: secret, workspaceId, ...(viewerUserId ? { viewerUserId } : {}) })) as Array<{ content: string }>).map((x) => x.content).sort()
    expect(await contents('alice')).toEqual(['legacy', 'private', 'shared'])
    expect(await contents('bob')).toEqual(['legacy', 'shared'])
    expect(await contents()).toEqual(['legacy', 'shared'])
  })
})
