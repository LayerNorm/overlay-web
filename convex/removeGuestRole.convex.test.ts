import { convexTest } from 'convex-test'
import { beforeAll, expect, test } from 'vitest'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const migrate = makeFunctionReference<'mutation'>('migrations/removeGuestRole:migrateGuestsToMembersByServer')
const secret = 'remove-guest-role-test'
const TABLES = ['memberships', 'invitations', 'resourceGuests', 'sharingPolicies', 'slackSettings'] as const

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function runAll(t: ReturnType<typeof convexTest>, dryRun: boolean) {
  const totals: Record<string, { changed: number; pending: number }> = {}
  for (const table of TABLES) {
    let cursor: string | null = null
    totals[table] = { changed: 0, pending: 0 }
    for (;;) {
      const page: { changed: number; pending: number; isDone: boolean; continueCursor: string } =
        await t.mutation(migrate, { serverSecret: secret, table, dryRun, cursor, numItems: 1 })
      totals[table].changed += page.changed
      totals[table].pending += page.pending
      if (page.isDone) break
      cursor = page.continueCursor
    }
  }
  return totals
}

test('guests become members, guest leftovers are cleared, dry run changes nothing, rerun is zero', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const membership = (principalId: string, role: 'owner' | 'member' | 'guest', status: 'active' | 'suspended') =>
      ctx.db.insert('workspaceMemberships', {
        membershipId: `m-${principalId}`, workspaceId: 'ws', principalId, role, status, joinedAt: 1, updatedAt: 1,
      })
    await membership('p-owner', 'owner', 'active')
    await membership('p-member', 'member', 'active')
    await membership('p-guest', 'guest', 'active')
    await membership('p-away', 'guest', 'suspended')
    const invitation = (id: string, role: 'member' | 'guest', status: 'pending' | 'expired') =>
      ctx.db.insert('workspaceInvitations', {
        invitationId: id, workspaceId: 'ws', email: `${id}@example.com`, role, status,
        invitedByPrincipalId: 'p-owner', expiresAt: 10, createdAt: 1, updatedAt: 1,
      })
    await invitation('i-member', 'member', 'pending')
    await invitation('i-guest', 'guest', 'pending')
    await invitation('i-old-guest', 'guest', 'expired')
    await ctx.db.insert('workspaceResourceGuests', {
      resourceGuestId: 'g1', workspaceId: 'ws', resourceType: 'conversation', resourceId: 'c1', principalId: 'p-guest',
      accessRole: 'viewer', status: 'active', grantedByPrincipalId: 'p-owner', createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('workspaceSharingPolicies', {
      workspaceId: 'ws', publicLinksEnabled: true, guestExpirationDays: 30, createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('workspaceSharingPolicies', { workspaceId: 'ws2', publicLinksEnabled: true, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('slackSettings', {
      workspaceId: 'ws', whoCanAsk: 'linked', unlinkedPeople: 'link', guests: true, slackConnect: false,
      actionsInChannels: 'ask', updatedByUserId: 'u1', updatedAt: 1,
    })
  })

  const snapshot = () => t.run(async (ctx) => ({
    memberships: await ctx.db.query('workspaceMemberships').collect(),
    invitations: await ctx.db.query('workspaceInvitations').collect(),
    resourceGuests: await ctx.db.query('workspaceResourceGuests').collect(),
    policies: await ctx.db.query('workspaceSharingPolicies').collect(),
    slack: await ctx.db.query('slackSettings').collect(),
  }))
  const before = await snapshot()

  await expect(t.mutation(migrate, { serverSecret: 'wrong', table: 'memberships', dryRun: true })).rejects.toThrow()

  const preview = await runAll(t, true)
  expect(preview).toEqual({
    memberships: { changed: 2, pending: 0 },
    invitations: { changed: 2, pending: 1 },
    resourceGuests: { changed: 1, pending: 0 },
    sharingPolicies: { changed: 1, pending: 0 },
    slackSettings: { changed: 1, pending: 0 },
  })
  expect(await snapshot()).toEqual(before)

  expect(await runAll(t, false)).toEqual(preview)
  const after = await snapshot()
  expect(after.memberships.map((row) => [row.principalId, row.role, row.status])).toEqual([
    ['p-owner', 'owner', 'active'],
    ['p-member', 'member', 'active'],
    ['p-guest', 'member', 'active'],
    ['p-away', 'member', 'suspended'],
  ])
  expect(after.invitations.map((row) => [row.invitationId, row.role, row.status])).toEqual([
    ['i-member', 'member', 'pending'],
    ['i-guest', 'member', 'pending'],
    ['i-old-guest', 'member', 'expired'],
  ])
  expect(after.resourceGuests).toEqual([])
  expect(after.policies.every((row) => row.guestExpirationDays === undefined)).toBe(true)
  expect(after.slack[0]?.guests).toBeUndefined()
  expect(after.slack[0]?.whoCanAsk).toBe('linked')

  const rerun = await runAll(t, false)
  for (const table of TABLES) expect(rerun[table]).toEqual({ changed: 0, pending: 0 })
})
