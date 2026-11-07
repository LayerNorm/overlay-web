import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const view = makeFunctionReference<'query'>('collaboration/management:view')
const now = Date.now()

type Item = { id: string; kind: string; name: string; role?: string; status?: string; detail?: string; description?: string; avatarColor?: string; teamMemberPrincipalIds?: string[] }
type Response = { canManage: boolean; currentPrincipalId: string; currentRole: string; workspaceKind: string; items: Item[] }

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'Acme', slug: 'acme', status: 'active', createdAt: 1, updatedAt: 1 })
    const member = async (userId: string, role: 'owner' | 'admin' | 'member' | 'guest', options: { status?: 'active' | 'suspended'; type?: 'human' | 'agent'; email?: string } = {}) => {
      const type = options.type ?? 'human'
      await ctx.db.insert('workspacePrincipals', {
        workspaceId: 'ws', principalId: `p-${userId}`, type, displayName: `legacy ${userId}`,
        ...(type === 'human' ? { userId } : { agentId: userId }), ...(options.email ? { email: options.email } : {}), createdAt: 1, updatedAt: 1,
      } as never)
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role, status: options.status ?? 'active', joinedAt: 1, updatedAt: 1 })
    }
    await member('olivia', 'owner', { email: 'olivia@acme.test' })
    await member('mark', 'member')
    await member('gina', 'guest', { email: 'gina@guest.test' })
    await member('sam', 'member', { status: 'suspended' })
    await member('helper', 'member', { type: 'agent' })
    await ctx.db.insert('subscriptions', { userId: 'mark', firstName: 'Mark', lastName: 'Lee' } as never)
    await ctx.db.insert('workspaceAgentDefinitions', {
      agentId: 'helper', workspaceId: 'ws', principalId: 'p-helper', name: 'Helper', description: 'Answers questions', avatarColor: '#123456',
      instructions: '', harness: 'overlay', modelId: 'm', allowedToolIds: [], invocationPolicy: 'mention',
      visibility: 'workspace', createdByPrincipalId: 'p-olivia', createdAt: 1, updatedAt: 1,
    } as never)
    const invite = (invitationId: string, role: 'member' | 'guest', status: 'pending' | 'accepted', expiresAt: number) =>
      ctx.db.insert('workspaceInvitations', { invitationId, workspaceId: 'ws', email: `${invitationId}@x.test`, role, status, invitedByPrincipalId: 'p-olivia', expiresAt, createdAt: 1, updatedAt: 1 })
    await invite('pending-member', 'member', 'pending', now + 60_000)
    await invite('pending-guest', 'guest', 'pending', now + 60_000)
    await invite('expired', 'member', 'pending', now - 1)
    await invite('accepted', 'member', 'accepted', now + 60_000)
    await ctx.db.insert('workspaceResourceGuests', {
      resourceGuestId: 'g1', workspaceId: 'ws', principalId: 'p-gina', resourceType: 'conversation', resourceId: 'c1', accessRole: 'viewer',
      status: 'active', grantedByPrincipalId: 'p-olivia', createdAt: 1, updatedAt: 1,
    } as never)
    await ctx.db.insert('workspaceTeams', { teamId: 'team-1', workspaceId: 'ws', name: 'Design', createdByPrincipalId: 'p-olivia', createdAt: 1, updatedAt: 1 } as never)
    await ctx.db.insert('workspaceTeamMemberships', { teamMembershipId: 'tm-1', workspaceId: 'ws', teamId: 'team-1', principalId: 'p-mark', principalType: 'human', createdAt: 1 } as never)
  })
  const as = (subject: string) => t.withIdentity({ subject })
  return { t, as }
}

const ids = (response: unknown) => (response as Response).items.map(item => item.id)

test('people lists active humans with current names, and pending invitations only for managers', async () => {
  const { as } = await fixture()
  const forOwner = await as('olivia').query(view, { workspaceId: 'ws', view: 'people' }) as Response
  expect(forOwner).toMatchObject({ canManage: true, currentPrincipalId: 'p-olivia', currentRole: 'owner', workspaceKind: 'organization' })
  expect(ids(forOwner)).toEqual(['p-olivia', 'p-mark', 'pending-member'])
  // The account's name wins over the stale principal name; the email is the description.
  expect(forOwner.items.find(item => item.id === 'p-mark')?.name).toBe('Mark Lee')
  expect(forOwner.items.find(item => item.id === 'p-olivia')?.description).toBe('olivia@acme.test')
  const forMember = await as('mark').query(view, { workspaceId: 'ws', view: 'people' }) as Response
  expect(forMember.canManage).toBe(false)
  expect(ids(forMember)).toEqual(['p-olivia', 'p-mark'])
})

test('guests show their active grants and guest invitations to managers only', async () => {
  const { as } = await fixture()
  const forOwner = await as('olivia').query(view, { workspaceId: 'ws', view: 'guests' }) as Response
  expect(ids(forOwner)).toEqual(['p-gina', 'pending-guest'])
  expect(forOwner.items[0]?.detail).toBe('1 resource')
  const forMember = await as('mark').query(view, { workspaceId: 'ws', view: 'guests' }) as Response
  expect(ids(forMember)).toEqual(['p-gina'])
  expect(forMember.items[0]?.detail).toBe('0 resources')
})

test('teams, roles and agents match the settings tabs', async () => {
  const { as } = await fixture()
  const teams = await as('mark').query(view, { workspaceId: 'ws', view: 'teams' }) as Response
  expect(teams.items).toEqual([expect.objectContaining({ id: 'team-1', name: 'Design', detail: '1 member', teamMemberPrincipalIds: ['p-mark'] })])
  const roles = await as('mark').query(view, { workspaceId: 'ws', view: 'roles' }) as Response
  expect(roles.items.map(item => item.detail)).toEqual(['1 principal', '0 principals', '2 principals', '1 principal'])
  const agents = await as('mark').query(view, { workspaceId: 'ws', view: 'chats-agents' }) as Response
  expect(agents.items).toEqual([expect.objectContaining({ id: 'p-helper', name: 'legacy helper', description: 'Answers questions', avatarColor: '#123456' })])
})

test('suspended members, strangers and signed-out callers get nothing, and suspension applies live', async () => {
  const { t, as } = await fixture()
  expect(await as('sam').query(view, { workspaceId: 'ws', view: 'people' })).toBeNull()
  expect(await as('stranger').query(view, { workspaceId: 'ws', view: 'people' })).toBeNull()
  expect(await t.query(view, { workspaceId: 'ws', view: 'people' })).toBeNull()
  await t.run(async ctx => {
    const row = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', 'ws').eq('principalId', 'p-mark')).unique()
    await ctx.db.patch(row!._id, { status: 'suspended' })
  })
  expect(await as('mark').query(view, { workspaceId: 'ws', view: 'people' })).toBeNull()
  expect(ids(await as('olivia').query(view, { workspaceId: 'ws', view: 'people' }))).toEqual(['p-olivia', 'pending-member'])
})
