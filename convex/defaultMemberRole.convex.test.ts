import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { MEMBER_AUTHORIZATION_CAPABILITIES } from '../src/shared/authorization/default-member-role'
const modules = import.meta.glob('./**/*.ts')
const initialize = makeFunctionReference<'mutation'>('authorization/defaults:ensureDefaultUserRoleByServer')
  test('ordinary shell initialization is idempotent and cannot create operator privileges', async () => {
    process.env.INTERNAL_API_SECRET = 'web-test-only'
    const t = convexTest(schema, modules)
    await Promise.all(Array.from({ length: 3 }, () => t.mutation(initialize, { serverSecret: 'web-test-only', userId: 'member_1' })))
    const result = await t.run(async ctx => ({
      roles: await ctx.db.query('authorizationRoles').collect(),
      assignments: await ctx.db.query('authorizationUserRoles').collect(),
      operators: await ctx.db.query('administrativePrincipals').collect(),
    }))
    expect(result.roles).toHaveLength(1)
    expect(result.roles[0].roleId).toBe('system:member')
    expect(result.roles[0].capabilities).toEqual(MEMBER_AUTHORIZATION_CAPABILITIES)
    expect(result.roles[0].capabilities).not.toContain('administration.access')
    expect(result.assignments).toHaveLength(1)
    expect(result.operators).toEqual([])
    await expect(t.mutation(initialize, { serverSecret: 'wrong', userId: 'member_2' })).rejects.toThrow(/Unauthorized/)
    await expect(t.mutation(initialize, { serverSecret: 'web-test-only', userId: 'member_2', roleId: 'system:administrator' })).rejects.toThrow()
  })
  test('explicit customer assignments are preserved', async () => {
    process.env.INTERNAL_API_SECRET = 'web-test-only'
    const t = convexTest(schema, modules)
    await t.run(async ctx => { await ctx.db.insert('authorizationUserRoles', { userId: 'custom_1', roleId: 'custom:restricted', createdAt: 1 }) })
    await t.mutation(initialize, { serverSecret: 'web-test-only', userId: 'custom_1' })
    expect(await t.run(async ctx => (await ctx.db.query('authorizationUserRoles').collect()).map(a => a.roleId))).toEqual(['custom:restricted'])
  })
