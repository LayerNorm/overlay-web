import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import type { AuthorizationRepositories } from '@overlay/authz-contracts'
import { AuthorizationService } from './AuthorizationService'
import {
  FIXED_AUTHORIZATION_ROLE_IDS,
  FixedRoleAuthorizationBridge,
} from './FixedRoleAuthorizationBridge'

export async function runAuthorizationRepositoryContract(
  t: TestContext,
  args: {
    cleanupUser(userId: string): Promise<void>
    createUser(userId: string): Promise<void>
    repositories: AuthorizationRepositories
    scope: string
  },
): Promise<void> {
  const userId = `${args.scope}_user`
  const roleId = `${args.scope}_role`
  const groupId = `${args.scope}_group`
  const grantId = `${args.scope}_grant`

  await args.createUser(userId)
  try {
    await t.test('persists custom roles and capabilities', async () => {
      const created = await args.repositories.roles.create({
        id: roleId,
        name: `${args.scope} Knowledge Curator`,
        description: 'Curates shared knowledge without deployment administration.',
        capabilities: ['knowledge.read', 'knowledge.edit', 'files.read'],
        createdBy: userId,
      })
      assert.equal(created.id, roleId)
      assert.deepEqual(created.capabilities, ['knowledge.read', 'knowledge.edit', 'files.read'])
      assert.equal((await args.repositories.roles.get(roleId))?.description, created.description)

      const updated = await args.repositories.roles.update({
        id: roleId,
        capabilities: ['knowledge.read', 'knowledge.edit', 'knowledge.publish', 'files.read'],
      })
      assert.ok(updated?.capabilities.includes('knowledge.publish'))
      assert.ok((await args.repositories.roles.list()).some((role) => role.id === roleId))
    })

    await t.test('persists groups, memberships, and role assignments idempotently', async () => {
      const group = await args.repositories.groups.create({
        id: groupId,
        name: `${args.scope} Curriculum Team`,
        source: 'local',
        createdBy: userId,
      })
      assert.equal(group.id, groupId)
      await args.repositories.groups.addMember({ groupId, userId })
      await args.repositories.groups.addMember({ groupId, userId })
      assert.equal((await args.repositories.groups.listMembers(groupId)).length, 1)
      assert.deepEqual((await args.repositories.groups.listForUser(userId)).map(({ id }) => id), [groupId])

      await args.repositories.assignments.assignUser({ userId, roleId, assignedBy: userId })
      await args.repositories.assignments.assignUser({ userId, roleId, assignedBy: userId })
      assert.equal((await args.repositories.assignments.listForUser(userId)).length, 1)
      assert.equal((await args.repositories.assignments.listUsersForRole(roleId)).length, 1)

      await args.repositories.assignments.assignGroup({ groupId, roleId, assignedBy: userId })
      await args.repositories.assignments.assignGroup({ groupId, roleId, assignedBy: userId })
      assert.equal((await args.repositories.assignments.listForGroups([groupId])).length, 1)
      assert.equal((await args.repositories.assignments.listGroupsForRole(roleId)).length, 1)
    })

    await t.test('persists direct, group, and role resource ACLs', async () => {
      const grant = await args.repositories.resourceGrants.upsert({
        id: grantId,
        resourceType: 'knowledge_base',
        resourceId: `${args.scope}_knowledge`,
        principalType: 'group',
        principalId: groupId,
        accessRole: 'viewer',
        grantedBy: userId,
      })
      assert.equal(grant.accessRole, 'viewer')
      const upgraded = await args.repositories.resourceGrants.upsert({
        ...grant,
        accessRole: 'editor',
      })
      assert.equal(upgraded.id, grantId)
      assert.equal(upgraded.accessRole, 'editor')
      assert.equal((await args.repositories.resourceGrants.listForResource({
        resourceType: 'knowledge_base',
        resourceId: `${args.scope}_knowledge`,
      })).length, 1)
      assert.equal((await args.repositories.resourceGrants.listForPrincipals({
        userId,
        groupIds: [groupId],
        roleIds: [roleId],
        resourceType: 'knowledge_base',
      })).length, 1)
      const decision = await new AuthorizationService({
        repositories: args.repositories,
      }).checkResourceAccess({
        userId,
        capability: 'knowledge.edit',
        resourceType: 'knowledge_base',
        resourceId: `${args.scope}_knowledge`,
        action: 'edit',
      })
      assert.equal(decision.allowed, true)
      assert.equal(decision.effectiveAccessRole, 'editor')
      assert.equal(await args.repositories.resourceGrants.remove(grantId), true)
      assert.equal(await args.repositories.resourceGrants.remove(grantId), false)
      await args.repositories.resourceGrants.upsert({
        id: `${grantId}_account_cleanup`,
        resourceType: 'knowledge_base',
        resourceId: `${args.scope}_account_cleanup`,
        principalType: 'user',
        principalId: userId,
        accessRole: 'owner',
        grantedBy: userId,
      })
    })

    await t.test('migrates fixed administrative roles idempotently', async () => {
      const bridge = new FixedRoleAuthorizationBridge(args.repositories)
      await bridge.syncPrincipal({
        userId,
        role: 'admin',
        grantedBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      await bridge.syncPrincipal({
        userId,
        role: 'admin',
        grantedBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      const systemRole = await args.repositories.roles.get(FIXED_AUTHORIZATION_ROLE_IDS.admin)
      assert.equal(systemRole?.isSystem, true)
      assert.ok(systemRole?.capabilities.includes('roles.manage'))
      assert.equal((await args.repositories.assignments.listForUser(userId))
        .filter(({ roleId }) => roleId === FIXED_AUTHORIZATION_ROLE_IDS.admin).length, 1)
      assert.equal((await new AuthorizationService({ repositories: args.repositories })
        .checkCapability({ userId, capability: 'roles.manage' })).allowed, true)
      await bridge.revokePrincipal(userId)
      assert.equal((await args.repositories.assignments.listForUser(userId))
        .some(({ roleId }) => roleId === FIXED_AUTHORIZATION_ROLE_IDS.admin), false)
    })

    await t.test('archives roles and groups without returning them by default', async () => {
      assert.equal(await args.repositories.roles.archive({ id: roleId, archivedBy: userId }), true)
      assert.equal(await args.repositories.groups.archive({ id: groupId, archivedBy: userId }), true)
      assert.ok(!(await args.repositories.roles.list()).some(({ id }) => id === roleId))
      assert.ok(!(await args.repositories.groups.list()).some(({ id }) => id === groupId))
      assert.ok((await args.repositories.roles.list({ includeArchived: true })).some(({ id }) => id === roleId))
      assert.ok((await args.repositories.groups.list({ includeArchived: true })).some(({ id }) => id === groupId))
    })
  } finally {
    await args.cleanupUser(userId)
    assert.equal((await args.repositories.groups.listMembers(groupId)).length, 0)
    assert.equal((await args.repositories.assignments.listForUser(userId)).length, 0)
    assert.equal((await args.repositories.resourceGrants.listForPrincipals({
      userId,
      groupIds: [],
      roleIds: [],
      resourceType: 'knowledge_base',
    })).length, 0)
  }
}
