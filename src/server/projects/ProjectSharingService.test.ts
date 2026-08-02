import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AuthorizationRepositories,
  ResourceGrant,
} from '@overlay/authz-contracts'
import { AuthorizationService } from '@/server/authorization/AuthorizationService'
import type { AuditService } from '@/server/admin'
import type { ProjectRepository } from './ProjectRepository'
import { ProjectSharingService } from './ProjectSharingService'
import { ProjectServiceError } from './ProjectService'

function fixture() {
  const grants: ResourceGrant[] = []
  const auditActions: string[] = []
  const roles = [{
    id: 'share_role',
    name: 'Project sharer',
    capabilities: ['projects.share' as const],
    isSystem: false,
    createdAt: 1,
    updatedAt: 1,
  }]
  const groups = [{
    id: 'group_1',
    name: 'Research',
    source: 'local' as const,
    createdAt: 1,
    updatedAt: 1,
  }]
  const repositories: AuthorizationRepositories = {
    roles: {
      async create(input) {
        return { ...input, isSystem: false, createdAt: 1, updatedAt: 1 }
      },
      async get(id) { return roles.find((role) => role.id === id) ?? null },
      async list() { return roles },
      async update() { return null },
      async archive() { return false },
    },
    groups: {
      async create(input) {
        return { ...input, source: input.source ?? 'local', createdAt: 1, updatedAt: 1 }
      },
      async get(id) { return groups.find((group) => group.id === id) ?? null },
      async list() { return groups },
      async update() { return null },
      async archive() { return false },
      async addMember({ groupId, userId, source = 'local' }) {
        return { groupId, userId, source, createdAt: 1 }
      },
      async removeMember() { return false },
      async listMembers() { return [] },
      async listForUser() { return [] },
    },
    assignments: {
      async assignUser({ userId, roleId, assignedBy }) {
        return { userId, roleId, assignedBy, createdAt: 1 }
      },
      async revokeUser() { return false },
      async listForUser(userId) {
        return userId === 'owner' || userId === 'capable_non_owner'
          ? [{ userId, roleId: 'share_role', createdAt: 1 }]
          : []
      },
      async listUsersForRole() { return [] },
      async assignGroup({ groupId, roleId, assignedBy }) {
        return { groupId, roleId, assignedBy, createdAt: 1 }
      },
      async revokeGroup() { return false },
      async listForGroups() { return [] },
      async listGroupsForRole() { return [] },
    },
    resourceGrants: {
      async upsert(input) {
        const existing = grants.find((grant) => (
          grant.resourceType === input.resourceType
          && grant.resourceId === input.resourceId
          && grant.principalType === input.principalType
          && grant.principalId === input.principalId
        ))
        const now = Date.now()
        const grant = {
          ...input,
          id: existing?.id ?? input.id,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }
        if (existing) grants.splice(grants.indexOf(existing), 1, grant)
        else grants.push(grant)
        return grant
      },
      async remove(id) {
        const index = grants.findIndex((grant) => grant.id === id)
        if (index < 0) return false
        grants.splice(index, 1)
        return true
      },
      async listForResource({ resourceType, resourceId }) {
        return grants.filter((grant) => (
          grant.resourceType === resourceType && grant.resourceId === resourceId
        ))
      },
      async listForPrincipals() { return [] },
    },
    resourceOwners: {
      async getOwner({ resourceType, resourceId }) {
        return resourceType === 'project' && resourceId === 'project_1' ? 'owner' : null
      },
    },
  }
  const projects = {
    async getProject({ projectId, userId }) {
      return projectId === 'project_1' && userId === 'owner'
        ? { _id: projectId, userId, name: 'Project', createdAt: 1, updatedAt: 1 }
        : null
    },
  } as ProjectRepository
  const service = new ProjectSharingService({
    authorization: new AuthorizationService({ repositories }),
    authorizationRepositories: repositories,
    projects,
    users: {
      async upsertFromIdentity() {
        return { success: true, isNewUser: false, userId: 'owner' }
      },
      async listDirectory() {
        return [
          { id: 'owner', email: 'owner@example.com', name: 'Owner' },
          { id: 'user_2', email: 'user@example.com', name: 'Collaborator' },
        ]
      },
    },
    audit: {
      async record(args) { auditActions.push(args.action) },
    } as AuditService,
  })
  return { service, grants, auditActions }
}

test('ProjectSharingService grants and revokes user, group, and role access', async () => {
  const { service, grants, auditActions } = fixture()
  const directory = await service.listDirectory('owner')
  assert.equal(directory.users.length, 2)
  assert.equal(directory.groups[0]?.name, 'Research')
  assert.equal(directory.roles[0]?.name, 'Project sharer')

  for (const [principalType, principalId] of [
    ['user', 'user_2'],
    ['group', 'group_1'],
    ['role', 'share_role'],
  ] as const) {
    await service.shareProject({
      projectId: 'project_1',
      userId: 'owner',
      principalType,
      principalId,
      accessRole: principalType === 'user' ? 'editor' : 'viewer',
    })
  }

  assert.equal(grants.length, 3)
  assert.ok(grants.every(({ resourceType }) => resourceType === 'project'))
  assert.equal((await service.listShares({
    projectId: 'project_1',
    userId: 'owner',
  })).length, 3)

  await service.revokeProjectShare({
    projectId: 'project_1',
    userId: 'owner',
    grantId: grants[0]!.id,
  })
  assert.equal(grants.length, 2)
  assert.deepEqual(auditActions, [
    'project.share.grant',
    'project.share.grant',
    'project.share.grant',
    'project.share.revoke',
  ])
})

test('ProjectSharingService does not let a capable non-owner manage project grants', async () => {
  const { service } = fixture()
  await assert.rejects(
    service.listShares({ projectId: 'project_1', userId: 'capable_non_owner' }),
    (error: unknown) => error instanceof ProjectServiceError && error.statusCode === 404,
  )
  await assert.rejects(
    service.shareProject({
      projectId: 'project_1',
      userId: 'capable_non_owner',
      principalType: 'user',
      principalId: 'user_2',
      accessRole: 'viewer',
    }),
    (error: unknown) => error instanceof ProjectServiceError && error.statusCode === 404,
  )
})

test('ProjectSharingService validates directory principals before persisting access', async () => {
  const { service, grants } = fixture()
  await assert.rejects(
    service.shareProject({
      projectId: 'project_1',
      userId: 'owner',
      principalType: 'group',
      principalId: 'missing_group',
      accessRole: 'viewer',
    }),
    (error: unknown) => error instanceof ProjectServiceError && error.statusCode === 404,
  )
  assert.equal(grants.length, 0)
})
