import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const fn = {
  list: makeFunctionReference<'query'>('integrations/skillsBrowse:list'),
  create: makeFunctionReference<'mutation'>('integrations/skillsBrowse:create'),
  update: makeFunctionReference<'mutation'>('integrations/skillsBrowse:update'),
  remove: makeFunctionReference<'mutation'>('integrations/skillsBrowse:remove'),
}
const backendUrl = 'https://fixture.convex.cloud'

afterEach(() => { vi.unstubAllEnvs() })

async function fixture(options: { feature?: boolean } = {}) {
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', backendUrl)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'test')
  const t = convexTest(schema, modules)
  const shared = await t.run(async ctx => {
    await ctx.db.insert('nativeDeploymentPolicies', {
      key: 'web', sequence: 1, challenge: 'c', sourceOrigin: 'https://app.example.test', expiresAt: Date.now() + 600_000,
      snapshot: { version: 1, backendUrl, revision: 'a'.repeat(64), features: { skills: options.feature ?? true }, rollout: { stage: 'off', internalWorkspaceIds: '', invitedWorkspaceIds: '' } },
    } as never)
    await ctx.db.insert('authorizationRoles', { roleId: 'skills', name: 'Skills', capabilities: ['skills.use'], isSystem: false, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const [userId, role] of [['alice', 'member'], ['bob', 'member'], ['carol', 'member']] as const) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role, status: 'active', joinedAt: 1, updatedAt: 1 })
      if (userId !== 'carol') await ctx.db.insert('authorizationUserRoles', { roleId: 'skills', userId, createdAt: 1 })
    }
    return await ctx.db.insert('skills', { workspaceId: 'ws', userId: 'bob', scope: 'workspace', name: 'Team voice', description: 'd', instructions: 'i', version: 1, createdAt: 1, updatedAt: 1 } as never)
  })
  const as = (subject: string) => t.withIdentity({ subject })
  return { t, as, shared }
}

type Skill = { _id: string; name: string; enabled?: boolean; canEdit: boolean; version: number; updatedAt: number }

test('skills list live with edit rights; create, edit, toggle and delete follow the server rules', async () => {
  const { as, shared } = await fixture()
  const id = await as('alice').mutation(fn.create, { workspaceId: 'ws', name: ' Summaries ', description: 'Short', instructions: 'Be brief' })
  let skills = await as('alice').query(fn.list, { workspaceId: 'ws' }) as Skill[]
  expect(skills.map(skill => [skill.name, skill.canEdit])).toEqual([['Summaries', true], ['Team voice', false]])
  expect(await as('bob').query(fn.list, { workspaceId: 'ws' }) as Skill[]).toHaveLength(1)

  const before = skills[0]!
  await as('alice').mutation(fn.update, { workspaceId: 'ws', skillId: id, instructions: 'Be very brief', expectedUpdatedAt: before.updatedAt })
  await as('alice').mutation(fn.update, { workspaceId: 'ws', skillId: id, enabled: false })
  skills = await as('alice').query(fn.list, { workspaceId: 'ws' }) as Skill[]
  expect(skills[0]).toMatchObject({ enabled: false, version: 2 })
  // A form filled from the earlier version cannot overwrite the newer one.
  await expect(as('alice').mutation(fn.update, { workspaceId: 'ws', skillId: id, name: 'Stale', expectedUpdatedAt: before.updatedAt })).rejects.toThrow('SKILL_INVALID:conflict')
  await expect(as('alice').mutation(fn.update, { workspaceId: 'ws', skillId: id, name: '  ' })).rejects.toThrow('SKILL_INVALID:name_required')
  await expect(as('alice').mutation(fn.update, { workspaceId: 'ws', skillId: shared, name: 'Mine' })).rejects.toThrow('Unauthorized')
  await expect(as('bob').mutation(fn.remove, { workspaceId: 'ws', skillId: id })).rejects.toThrow('Unauthorized')
  await as('alice').mutation(fn.remove, { workspaceId: 'ws', skillId: id })
  expect((await as('alice').query(fn.list, { workspaceId: 'ws' }) as Skill[]).map(skill => skill.name)).toEqual(['Team voice'])
})

test('skills need skills.use, an active membership and the deployment feature', async () => {
  const { t, as } = await fixture()
  expect(await as('carol').query(fn.list, { workspaceId: 'ws' })).toBeNull()
  expect(await as('stranger').query(fn.list, { workspaceId: 'ws' })).toBeNull()
  expect(await t.query(fn.list, { workspaceId: 'ws' })).toBeNull()
  await expect(as('carol').mutation(fn.create, { workspaceId: 'ws', name: 'x', description: 'x', instructions: 'x' })).rejects.toThrow('CAPABILITY_ACCESS_DENIED')
  const off = await fixture({ feature: false })
  await expect(off.as('alice').mutation(fn.create, { workspaceId: 'ws', name: 'x', description: 'x', instructions: 'x' })).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
})
