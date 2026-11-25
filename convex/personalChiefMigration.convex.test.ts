import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'personal-chief-migration-secret'
const now = 1_900_000_000_000
const ensureChiefs = makeFunctionReference<'mutation'>('collaboration/agents:ensureChiefsByServer')
const retire = makeFunctionReference<'mutation'>('migrations/personalChiefs:retireSharedPersonalChiefsByServer')
const rename = makeFunctionReference<'mutation'>('migrations/personalChiefs:renamePersonalChiefsByServer')
const leaveChannels = makeFunctionReference<'mutation'>('migrations/personalChiefs:removePersonalAgentsFromChannelsByServer')
const unarchive = makeFunctionReference<'mutation'>('collaboration/agents:unarchiveByServer')
const view = makeFunctionReference<'query'>('collaboration/management:view')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

type Retired = { scanned: number; retired: number; alreadyRetired: number; roomsLeft: number; isDone: boolean }
type Renamed = { renamed: Array<{ userId: string; from: string; to: string }>; resynced: number; isDone: boolean }

/** An organization as earlier versions left it: Ada has a private chief and a shared copy that joined #general. */
async function fixture() {
  const t = convexTest(schema, modules)
  const channelId = await t.run(async (ctx) => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: now, updatedAt: now })
    for (const [userId, displayName, role] of [['ada', 'Ada Lovelace', 'owner'], ['bob', 'Bob Stone', 'member']] as const) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role, status: 'active', joinedAt: now, updatedAt: now })
    }
    return await ctx.db.insert('conversations', {
      userId: 'ada', workspaceId: 'ws', conversationType: 'channel', channelVisibility: 'public', title: 'general',
      lastModified: now, updatedAt: now, createdAt: now, lastMode: 'act', askModelIds: [], actModelId: 'model',
    })
  })
  for (const userId of ['ada', 'bob']) {
    await t.mutation(ensureChiefs, {
      serverSecret: secret, workspaceId: 'ws', actorUserId: userId, actorPrincipalId: `p-${userId}`, includePersonal: true, now,
    } as never)
  }
  await t.run(async (ctx) => {
    // Old names: Ada's was "<Full name>’s Overlay"; Bob chose his own.
    const identities = await ctx.db.query('personalChiefIdentities').collect()
    for (const identity of identities) {
      const name = identity.userId === 'ada' ? 'Ada Lovelace’s Overlay' : 'Jarvis'
      await ctx.db.patch(identity._id, { name })
      const rows = await ctx.db.query('workspaceAgentDefinitions')
        .withIndex('by_chiefOwnerUserId', (q) => q.eq('chiefOwnerUserId', identity.userId)).collect()
      for (const row of rows) await ctx.db.patch(row._id, { name })
    }
    const sharedPrincipalId = 'personal-chief-principal-workspace-ws-ada'
    await ctx.db.insert('workspacePrincipals', {
      principalId: sharedPrincipalId, workspaceId: 'ws', type: 'agent', agentId: 'personal-chief-workspace-ws-ada',
      displayName: 'Ada Lovelace’s Overlay', createdByPrincipalId: 'p-ada', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'personal-chief-workspace-ws-ada:membership', workspaceId: 'ws', principalId: sharedPrincipalId,
      role: 'member', status: 'active', joinedAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceAgentDefinitions', {
      agentId: 'personal-chief-workspace-ws-ada', workspaceId: 'ws', principalId: sharedPrincipalId,
      name: 'Ada Lovelace’s Overlay', instructions: 'Help.', harness: 'overlay', modelId: 'model', allowedToolIds: [],
      invocationPolicy: 'mention', visibility: 'workspace', createdByPrincipalId: 'p-ada', createdAt: now, updatedAt: now,
      teamIds: [], roomCount: 1, agentRole: 'personal_chief', chiefOwnerUserId: 'ada', chiefScope: 'workspace',
    })
    await ctx.db.insert('conversationParticipants', {
      conversationId: channelId, workspaceId: 'ws', principalId: sharedPrincipalId, principalType: 'agent',
      role: 'member', status: 'active', notificationLevel: 'mentions', joinedAt: now, updatedAt: now,
    })
  })
  return { t, channelId }
}

test('dry runs count and change nothing', async () => {
  const { t } = await fixture()
  const retired = await t.mutation(retire, { serverSecret: secret, dryRun: true } as never) as Retired
  expect(retired).toMatchObject({ retired: 1, alreadyRetired: 0, roomsLeft: 1, isDone: true })
  const renamed = await t.mutation(rename, { serverSecret: secret, dryRun: true } as never) as Renamed
  expect(renamed.renamed).toEqual([{ userId: 'ada', from: 'Ada Lovelace’s Overlay', to: 'Ada’s Chief' }])
  const shared = await t.run(async (ctx) => ctx.db.query('workspaceAgentDefinitions')
    .withIndex('by_agentId', (q) => q.eq('agentId', 'personal-chief-workspace-ws-ada')).unique())
  expect(shared?.archivedAt).toBeUndefined()
  const identity = await t.run(async (ctx) => ctx.db.query('personalChiefIdentities')
    .withIndex('by_userId', (q) => q.eq('userId', 'ada')).unique())
  expect(identity?.name).toBe('Ada Lovelace’s Overlay')
})

test('retires the shared copy, renames old names everywhere, keeps chosen names, and reruns change nothing', async () => {
  const { t, channelId } = await fixture()
  let cursor: string | null = null
  let retiredCount = 0
  let pages = 0
  do {
    pages++
    const page: Retired & { continueCursor: string | null } = await t.mutation(retire, { serverSecret: secret, dryRun: false, cursor, numItems: 2 } as never)
    retiredCount += page.retired
    cursor = page.continueCursor
  } while (cursor)
  expect(retiredCount).toBe(1)
  expect(pages).toBeGreaterThan(1)
  const renamed = await t.mutation(rename, { serverSecret: secret, dryRun: false } as never) as Renamed
  expect(renamed.renamed.map((change) => change.to)).toEqual(['Ada’s Chief'])

  const state = await t.run(async (ctx) => {
    const shared = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_agentId', (q) => q.eq('agentId', 'personal-chief-workspace-ws-ada')).unique()
    const membership = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', 'ws').eq('principalId', shared!.principalId)).unique()
    const participant = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', (q) => q.eq('conversationId', channelId).eq('principalId', shared!.principalId)).unique()
    const privateRow = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_agentId', (q) => q.eq('agentId', 'personal-chief-ws-ada')).unique()
    const privatePrincipal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', privateRow!.principalId)).unique()
    const bob = await ctx.db.query('personalChiefIdentities').withIndex('by_userId', (q) => q.eq('userId', 'bob')).unique()
    return { shared, membership, participant, privateRow, privatePrincipal, bob }
  })
  expect(state.shared).toMatchObject({ visibility: 'creator' })
  expect(state.shared?.archivedAt).toBeDefined()
  expect(state.membership?.status).toBe('suspended')
  expect(state.participant?.status).toBe('removed')
  expect(state.privateRow?.name).toBe('Ada’s Chief')
  expect(state.privateRow?.archivedAt).toBeUndefined()
  expect(state.privatePrincipal?.displayName).toBe('Ada’s Chief')
  expect(state.bob?.name).toBe('Jarvis')

  // A retired copy can't be restored, and nothing changes on a rerun.
  expect(await t.mutation(unarchive, {
    serverSecret: secret, workspaceId: 'ws', agentId: 'personal-chief-workspace-ws-ada', now: now + 1,
  } as never)).toBe(false)
  expect(await t.mutation(retire, { serverSecret: secret, dryRun: false } as never)).toMatchObject({ retired: 0, alreadyRetired: 1 })
  expect(await t.mutation(rename, { serverSecret: secret, dryRun: false } as never)).toMatchObject({ renamed: [], resynced: 0 })

  // Mentions and Settings → Agents list no personal chief, for anyone.
  for (const subject of ['ada', 'bob']) {
    const agents = await t.withIdentity({ subject }).query(view, { workspaceId: 'ws', view: 'chats-agents' }) as { items: Array<{ name: string }> }
    expect(agents.items.map((item) => item.name)).toEqual(['Overlay'])
  }
})

test('takes private personal chiefs out of channels and leaves their own threads alone', async () => {
  const { t, channelId } = await fixture()
  const bobChief = await t.run(async (ctx) => (await ctx.db.query('workspaceAgentDefinitions')
    .withIndex('by_chiefOwnerUserId', (q) => q.eq('chiefOwnerUserId', 'bob')).collect())
    .find((row) => row.agentRole === 'personal_chief' && row.chiefScope === 'personal'))
  // As the old createChannel did: Bob's private chief joined #general.
  await t.run(async (ctx) => {
    await ctx.db.insert('conversationParticipants', {
      conversationId: channelId, workspaceId: 'ws', principalId: bobChief!.principalId, principalType: 'agent',
      role: 'member', status: 'active', notificationLevel: 'mentions', joinedAt: now, updatedAt: now,
    })
  })
  type Left = { agents: number; removed: number; isDone: boolean }
  // Production order: retire the shared copies first, then clear channels of the rest.
  await t.mutation(retire, { serverSecret: secret, dryRun: false } as never)
  const dry = await t.mutation(leaveChannels, { serverSecret: secret, dryRun: true } as never) as Left
  expect(dry).toMatchObject({ agents: 1, removed: 1, isDone: true })
  const status = () => t.run(async (ctx) => (await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_principalId', (q) => q.eq('conversationId', channelId).eq('principalId', bobChief!.principalId)).unique())?.status)
  expect(await status()).toBe('active')
  await t.mutation(leaveChannels, { serverSecret: secret, dryRun: false } as never)
  expect(await status()).toBe('removed')
  const again = await t.mutation(leaveChannels, { serverSecret: secret, dryRun: false } as never) as Left
  expect(again).toMatchObject({ agents: 0, removed: 0 })
})

test('hands each shared-copy thread and automation to a chief its people can still open', async () => {
  const { t } = await fixture()
  const ids = await t.run(async (ctx) => {
    const thread = async (userId: string, title: string) => {
      const id = await ctx.db.insert('conversations', {
        userId, workspaceId: 'ws', conversationType: 'dm', agentId: 'personal-chief-workspace-ws-ada', title,
        lastModified: now, updatedAt: now, createdAt: now, lastMode: 'act', askModelIds: [], actModelId: 'model',
      })
      await ctx.db.insert('conversationParticipants', {
        conversationId: id, workspaceId: 'ws', principalId: 'personal-chief-principal-workspace-ws-ada', principalType: 'agent',
        role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now,
      })
      return id
    }
    const adaThread = await thread('ada', 'Ada’s thread')
    const bobThread = await thread('bob', 'Bob asked Ada’s chief')
    const sharedRunThread = await thread('ada', 'Workspace automation runs')
    const personal = await ctx.db.insert('automations', { userId: 'ada', workspaceId: 'ws', agentId: 'personal-chief-workspace-ws-ada', createdAt: now, updatedAt: now } as never)
    const shared = await ctx.db.insert('automations', { userId: 'ada', workspaceId: 'ws', scope: 'workspace', conversationId: sharedRunThread, agentId: 'personal-chief-workspace-ws-ada', createdAt: now, updatedAt: now } as never)
    const bobs = await ctx.db.insert('automations', { userId: 'bob', workspaceId: 'ws', agentId: 'personal-chief-workspace-ws-ada', createdAt: now, updatedAt: now } as never)
    return { adaThread, bobThread, sharedRunThread, personal, shared, bobs }
  })
  type Moved = Retired & { threadsMoved: number; automationsMoved: number; leftBehind: number }
  const dry = await t.mutation(retire, { serverSecret: secret, dryRun: true } as never) as Moved
  expect(dry).toMatchObject({ threadsMoved: 3, automationsMoved: 3, leftBehind: 0 })
  await t.mutation(retire, { serverSecret: secret, dryRun: false } as never)
  const after = await t.run(async (ctx) => {
    const own = (await ctx.db.query('workspaceAgentDefinitions').withIndex('by_chiefOwnerUserId', (q) => q.eq('chiefOwnerUserId', 'ada')).collect())
      .find((row) => row.chiefScope === 'personal')!
    const chief = (await ctx.db.query('workspaceAgentDefinitions').withIndex('by_workspaceId', (q) => q.eq('workspaceId', 'ws')).collect())
      .find((row) => row.agentRole === 'workspace_chief')!
    const agentOf = async (id: typeof ids.adaThread) => (await ctx.db.get(id))?.agentId
    const seats = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', (q) => q.eq('conversationId', ids.adaThread)).collect()
    return {
      own: own.agentId, ownPrincipal: own.principalId, chief: chief.agentId,
      ada: await agentOf(ids.adaThread), bob: await agentOf(ids.bobThread), sharedRun: await agentOf(ids.sharedRunThread),
      seats: seats.map((seat) => seat.principalId),
      personal: (await ctx.db.get(ids.personal))?.agentId, shared: (await ctx.db.get(ids.shared))?.agentId,
      bobs: (await ctx.db.get(ids.bobs))?.agentId,
    }
  })
  expect(after.ada).toBe(after.own)
  expect(after.seats).toContain(after.ownPrincipal)
  expect(after.bob).toBe(after.chief)
  expect(after.personal).toBe(after.own)
  expect(after.shared).toBe(after.chief)
  expect(after.sharedRun).toBe(after.chief)
  expect(after.bobs).toBe(after.chief)
})

test('leaves an archived workspace’s shared-copy threads in place instead of failing', async () => {
  const { t } = await fixture()
  await t.run(async (ctx) => {
    await ctx.db.insert('conversations', {
      userId: 'ada', workspaceId: 'ws', conversationType: 'dm', agentId: 'personal-chief-workspace-ws-ada', title: 'Old',
      lastModified: now, updatedAt: now, createdAt: now, lastMode: 'act', askModelIds: [], actModelId: 'model',
    })
    const workspace = await ctx.db.query('workspaces').withIndex('by_workspaceId', (q) => q.eq('workspaceId', 'ws')).unique()
    await ctx.db.patch(workspace!._id, { status: 'archived' } as never)
  })
  type Moved = Retired & { threadsMoved: number; leftBehind: number }
  const dry = await t.mutation(retire, { serverSecret: secret, dryRun: true } as never) as Moved
  expect(dry).toMatchObject({ threadsMoved: 0, leftBehind: 1 })
  await expect(t.mutation(retire, { serverSecret: secret, dryRun: false } as never)).resolves.toMatchObject({ isDone: true })
})

test('keeps a chosen name that only looks generated', async () => {
  const { t } = await fixture()
  await t.run(async (ctx) => {
    const bob = (await ctx.db.query('personalChiefIdentities').collect()).find((identity) => identity.userId === 'bob')!
    await ctx.db.patch(bob._id, { name: 'Bob’s Overlay' })
  })
  const renamed = await t.mutation(rename, { serverSecret: secret, dryRun: true } as never) as Renamed
  expect(renamed.renamed.map((entry) => entry.userId)).toEqual(['ada'])
})
