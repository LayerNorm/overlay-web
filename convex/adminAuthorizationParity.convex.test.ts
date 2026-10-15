import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
const modules = import.meta.glob('./**/*.ts')
const secret = 'operator-parity-test'
const role = { roleId: 'role_qa', name: 'QA role', capabilities: ['files.read'], isSystem: false }
const group = { groupId: 'group_qa', name: 'QA group', source: 'local' }
const grant = { grantId: 'grant_qa', resourceType: 'file', resourceId: 'file_qa', principalType: 'user', principalId: 'target_user', accessRole: 'viewer' }
const audit = { eventId: 'audit_qa', actorType: 'user', actorUserId: 'operator', action: 'qa.append', resourceType: 'qa', outcome: 'success', metadataJson: '{}', createdAt: 1 }
const reads = [
  ['getRole', { roleId: role.roleId }], ['listRoles', { includeArchived: false }],
  ['getGroup', { groupId: group.groupId }], ['listGroups', { includeArchived: false }],
  ['listGroupMembers', { groupId: group.groupId }], ['listGroupsForUser', { userId: 'target_user' }],
  ['listUserRoles', { userId: 'target_user' }], ['listUsersForRole', { roleId: role.roleId }],
  ['listGroupRoles', { groupIds: [group.groupId] }], ['listGroupsForRole', { roleId: role.roleId }],
  ['listResourceGrants', { resourceType: 'file', resourceId: 'file_qa' }],
  ['listPrincipalGrants', { userId: 'target_user', groupIds: [], roleIds: [] }],
  ['getResourceOwner', { resourceType: 'file', resourceId: 'missing' }],
  ['getPrincipal', { userId: 'operator' }], ['listPrincipals', {}], ['listAudit', {}], ['listUserDirectory', {}],
] satisfies [string, Record<string, unknown>][]
const writes = [
  ['createRole', role], ['updateRole', { roleId: role.roleId, description: 'updated' }],
  ['createGroup', group], ['updateGroup', { groupId: group.groupId, description: 'updated' }],
  ['addGroupMember', { groupId: group.groupId, userId: 'target_user', source: 'local' }],
  ['assignUserRole', { userId: 'target_user', roleId: role.roleId }],
  ['assignGroupRole', { groupId: group.groupId, roleId: role.roleId }], ['upsertResourceGrant', grant],
  ['removeResourceGrant', { grantId: grant.grantId }],
  ['revokeUserRole', { userId: 'target_user', roleId: role.roleId }],
  ['revokeGroupRole', { groupId: group.groupId, roleId: role.roleId }],
  ['removeGroupMember', { groupId: group.groupId, userId: 'target_user' }],
  ['archiveGroup', { groupId: group.groupId }], ['archiveRole', { roleId: role.roleId }],
  ['grantPrincipal', { userId: 'target_user', role: 'support', grantedBy: 'operator' }],
  ['revokePrincipal', { userId: 'target_user', revokedBy: 'operator' }], ['appendAudit', audit],
] satisfies [string, Record<string, unknown>][]

async function fixture() {
  process.env.ADMIN_API_SECRET = secret
  process.env.INTERNAL_API_SECRET = 'customer-web-test'
  const t = convexTest(schema, modules)
  await t.run(async ctx => { await ctx.db.insert('administrativePrincipals', { userId: 'operator', role: 'admin', createdAt: 1, updatedAt: 1 }) })
  return { t, operator: t.withIdentity({ subject: 'operator' }) }
}

test('every operator endpoint rejects the customer secret and an absent operator identity', async () => {
  const { t, operator } = await fixture()
  for (const [name, args] of reads) {
    const ref = makeFunctionReference<'query'>(`admin/console:${name}`)
    await expect(operator.query(ref, { ...args, serverSecret: 'customer-web-test' })).rejects.toThrow(/Unauthorized/)
    await expect(t.query(ref, { ...args, serverSecret: secret })).rejects.toThrow(/Unauthorized/)
  }
  for (const [name, args] of writes) {
    const ref = makeFunctionReference<'mutation'>(`admin/console:${name}`)
    await expect(operator.mutation(ref, { ...args, serverSecret: 'customer-web-test' })).rejects.toThrow(/Unauthorized/)
    await expect(t.mutation(ref, { ...args, serverSecret: secret })).rejects.toThrow(/Unauthorized/)
  }
})

test('operator CRUD, membership, assignments and grants persist with atomic audit events', async () => {
  const { t, operator } = await fixture()
  let i = 0
  for (const [name, args] of writes) {
    await operator.mutation(makeFunctionReference<'mutation'>(`admin/console:${name}`), { ...args, serverSecret: secret })
    i++
    expect(await t.run(async ctx => (await ctx.db.query('auditEvents').collect()).length)).toBe(i)
    if (name === 'upsertResourceGrant') {
      for (const [queryName, queryArgs] of reads) {
        await operator.query(makeFunctionReference<'query'>(`admin/console:${queryName}`), { ...queryArgs, serverSecret: secret })
      }
      expect(await t.run(async ctx => (await ctx.db.query('authorizationGroupMemberships').collect()).length)).toBe(1)
    }
  }
  const final = await t.run(async ctx => ({
    memberships: await ctx.db.query('authorizationGroupMemberships').collect(),
    userRoles: await ctx.db.query('authorizationUserRoles').collect(), groupRoles: await ctx.db.query('authorizationGroupRoles').collect(),
    grants: await ctx.db.query('authorizationResourceGrants').collect(), principals: await ctx.db.query('administrativePrincipals').collect(),
  }))
  expect(final.memberships).toEqual([]); expect(final.userRoles).toEqual([]); expect(final.groupRoles).toEqual([]); expect(final.grants).toEqual([])
  expect(final.principals.find(p => p.userId === 'target_user')?.revokedAt).toBeTypeOf('number')
})
