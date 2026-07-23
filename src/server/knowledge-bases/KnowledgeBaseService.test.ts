import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  KnowledgeBase,
  KnowledgeBaseConversation,
  KnowledgeBaseRepositories,
  KnowledgeBaseSource,
  KnowledgeSource,
  KnowledgeSourceVersion,
} from '@overlay/app-core'
import type {
  AuthorizationGroup,
  AuthorizationRepositories,
  AuthorizationRole,
  GroupMembership,
  GroupRoleAssignment,
  ResourceGrant,
  UserRoleAssignment,
} from '@overlay/authz-contracts'
import { AuthorizationService } from '@/server/authorization/AuthorizationService'
import {
  KnowledgeBaseService,
  KnowledgeBaseServiceError,
} from './KnowledgeBaseService'

test('knowledge-base service enforces owner, editor, viewer, and private boundaries', async () => {
  const fixture = createFixture()
  const service = fixture.service
  const base = await service.createKnowledgeBase({
    userId: 'owner',
    title: ' IB Chemistry ',
    kind: 'organization',
  })
  assert.equal(base.title, 'IB Chemistry')

  fixture.grants.push(
    resourceGrant('editor-grant', base.id, 'editor', 'editor'),
    resourceGrant('viewer-grant', base.id, 'viewer', 'viewer'),
  )
  assert.deepEqual((await service.listKnowledgeBases('owner')).map(({ id }) => id), [base.id])
  assert.deepEqual((await service.listKnowledgeBases('editor')).map(({ id }) => id), [base.id])
  assert.deepEqual((await service.listKnowledgeBases('viewer')).map(({ id }) => id), [base.id])
  assert.deepEqual(await service.listKnowledgeBases('admin'), [])
  assert.deepEqual(await service.listKnowledgeBases('unshared'), [])

  assert.equal((await service.getKnowledgeBase({ knowledgeBaseId: base.id, userId: 'viewer' })).id, base.id)
  await assert.rejects(
    service.updateKnowledgeBase({ knowledgeBaseId: base.id, title: 'Denied', userId: 'viewer' }),
    (error: unknown) => error instanceof KnowledgeBaseServiceError && error.statusCode === 404,
  )
  assert.equal((await service.updateKnowledgeBase({
    knowledgeBaseId: base.id,
    title: 'IB Chemistry Curriculum',
    userId: 'editor',
  })).title, 'IB Chemistry Curriculum')
  await assert.rejects(
    service.deleteKnowledgeBase({ knowledgeBaseId: base.id, userId: 'editor' }),
    (error: unknown) => error instanceof KnowledgeBaseServiceError && error.statusCode === 404,
  )
  await assert.rejects(
    service.getKnowledgeBase({ knowledgeBaseId: base.id, userId: 'unshared' }),
    (error: unknown) => error instanceof KnowledgeBaseServiceError && error.statusCode === 404,
  )
})

test('knowledge-base editors can manage their own canonical sources without taking another owner source', async () => {
  const fixture = createFixture()
  const base = await fixture.service.createKnowledgeBase({ userId: 'owner', title: 'Shared Brain' })
  fixture.grants.push(
    resourceGrant('editor-grant', base.id, 'editor', 'editor'),
    resourceGrant('viewer-grant', base.id, 'viewer', 'viewer'),
  )

  const detail = await fixture.service.createAndAttachSource({
    knowledgeBaseId: base.id,
    kind: 'file',
    sourceRef: 'editor-file',
    title: 'Organic Chemistry.pdf',
    userId: 'editor',
  })
  assert.equal(detail.source.ownerUserId, 'editor')
  assert.equal((await fixture.service.listSources({ knowledgeBaseId: base.id, userId: 'viewer' })).length, 1)
  await fixture.service.setSourceEnabled({
    knowledgeBaseId: base.id,
    sourceId: detail.source.id,
    enabled: false,
    userId: 'editor',
  })
  assert.equal((await fixture.service.listSources({ knowledgeBaseId: base.id, userId: 'owner' }))[0]?.membership.enabled, false)

  const privateSource = await fixture.repositories.sources.create({
    id: 'owner-private-source',
    ownerUserId: 'owner',
    kind: 'file',
    title: 'Private.pdf',
    metadata: {},
    createdBy: 'owner',
  })
  await assert.rejects(
    fixture.service.attachExistingSource({
      knowledgeBaseId: base.id,
      sourceId: privateSource.id,
      userId: 'editor',
    }),
    (error: unknown) => error instanceof KnowledgeBaseServiceError && error.statusCode === 404,
  )
  await fixture.service.deleteCanonicalSource({ sourceId: detail.source.id, userId: 'editor' })
  assert.equal(await fixture.repositories.sources.get(detail.source.id), null)
  assert.equal((await fixture.repositories.memberships.listForBase(base.id)).length, 0)
})

test('knowledge-base chat attachment permits viewers while preserving private conversation ownership', async () => {
  const fixture = createFixture()
  const base = await fixture.service.createKnowledgeBase({ userId: 'owner', title: 'Grounded Chat' })
  fixture.owners.set('conversation:owner-chat', 'owner')
  fixture.owners.set('conversation:viewer-chat', 'viewer')
  fixture.owners.set('conversation:foreign-chat', 'unshared')

  const attached = await fixture.service.attachConversation({
    conversationId: 'owner-chat',
    knowledgeBaseId: base.id,
    userId: 'owner',
  })
  assert.equal(attached.knowledgeBaseId, base.id)
  await assert.rejects(
    fixture.service.attachConversation({
      conversationId: 'foreign-chat',
      knowledgeBaseId: base.id,
      userId: 'owner',
    }),
    (error: unknown) => error instanceof KnowledgeBaseServiceError && error.statusCode === 404,
  )

  fixture.grants.push(resourceGrant('viewer-grant', base.id, 'viewer', 'viewer'))
  const viewerAttachment = await fixture.service.attachConversation({
    conversationId: 'viewer-chat',
    knowledgeBaseId: base.id,
    userId: 'viewer',
  })
  assert.equal(viewerAttachment.knowledgeBaseId, base.id)
  assert.equal((await fixture.service.getConversationKnowledgeBase({
    conversationId: 'viewer-chat',
    userId: 'viewer',
  }))?.id, base.id)
  await assert.rejects(
    fixture.service.getConversationKnowledgeBase({
      conversationId: 'viewer-chat',
      userId: 'owner',
    }),
    (error: unknown) => error instanceof KnowledgeBaseServiceError && error.statusCode === 404,
  )
  await fixture.service.detachConversation({ conversationId: 'viewer-chat', userId: 'viewer' })
  assert.equal(await fixture.repositories.conversations.getForConversation('viewer-chat'), null)

  await fixture.service.deleteKnowledgeBase({ knowledgeBaseId: base.id, userId: 'owner' })
  assert.equal(await fixture.repositories.bases.get(base.id), null)
  assert.equal(fixture.grants.some(({ resourceId }) => resourceId === base.id), false)
})

test('knowledge-base owners distribute access to users, groups, and custom roles with immediate revocation', async () => {
  const fixture = createFixture()
  const base = await fixture.service.createKnowledgeBase({ userId: 'owner', title: 'Distributed Brain' })
  fixture.groups.push({
    id: 'students',
    name: 'Students',
    source: 'local',
    createdAt: 1,
    updatedAt: 1,
  })
  fixture.memberships.push({ groupId: 'students', userId: 'group-viewer', source: 'local', createdAt: 1 })

  const direct = await fixture.service.shareKnowledgeBase({
    accessRole: 'viewer',
    knowledgeBaseId: base.id,
    principalId: 'unshared',
    principalType: 'user',
    userId: 'owner',
  })
  const group = await fixture.service.shareKnowledgeBase({
    accessRole: 'viewer',
    knowledgeBaseId: base.id,
    principalId: 'students',
    principalType: 'group',
    userId: 'owner',
  })
  const role = await fixture.service.shareKnowledgeBase({
    accessRole: 'editor',
    knowledgeBaseId: base.id,
    principalId: 'editor-role',
    principalType: 'role',
    userId: 'owner',
  })

  assert.equal((await fixture.service.listShares({ knowledgeBaseId: base.id, userId: 'owner' })).length, 3)
  assert.equal((await fixture.service.getKnowledgeBase({ knowledgeBaseId: base.id, userId: 'unshared' })).id, base.id)
  assert.equal((await fixture.service.getKnowledgeBase({ knowledgeBaseId: base.id, userId: 'group-viewer' })).id, base.id)
  assert.equal((await fixture.service.updateKnowledgeBase({
    knowledgeBaseId: base.id,
    title: 'Edited through custom role',
    userId: 'role-editor',
  })).title, 'Edited through custom role')

  await fixture.service.revokeKnowledgeBaseShare({
    grantId: direct.id,
    knowledgeBaseId: base.id,
    userId: 'owner',
  })
  await assert.rejects(
    fixture.service.getKnowledgeBase({ knowledgeBaseId: base.id, userId: 'unshared' }),
    (error: unknown) => error instanceof KnowledgeBaseServiceError && error.statusCode === 404,
  )
  assert.equal(group.principalType, 'group')
  assert.equal(role.principalType, 'role')
})

function createFixture() {
  const roles: AuthorizationRole[] = [
    role('member', [
      'knowledge.create', 'knowledge.read', 'knowledge.edit', 'knowledge.delete',
      'knowledge.share', 'conversations.read', 'conversations.edit',
    ]),
    role('editor-role', ['knowledge.read', 'knowledge.edit', 'knowledge.delete']),
    role('viewer-role', ['knowledge.read', 'conversations.read', 'conversations.edit']),
    role('admin-role', [
      'administration.access', 'knowledge.create', 'knowledge.read', 'knowledge.edit',
      'knowledge.share', 'knowledge.delete',
    ]),
  ]
  const groups: AuthorizationGroup[] = []
  const memberships: GroupMembership[] = []
  const userRoles: UserRoleAssignment[] = [
    assignment('owner', 'member'),
    assignment('editor', 'editor-role'),
    assignment('viewer', 'viewer-role'),
    assignment('unshared', 'viewer-role'),
    assignment('group-viewer', 'viewer-role'),
    assignment('role-editor', 'editor-role'),
    assignment('admin', 'admin-role'),
  ]
  const groupRoles: GroupRoleAssignment[] = []
  const grants: ResourceGrant[] = []
  const owners = new Map<string, string>()
  const authorizationRepositories: AuthorizationRepositories = {
    roles: {
      async create() { throw new Error('not used') },
      async get(id) { return roles.find((value) => value.id === id) ?? null },
      async list() { return roles },
      async update() { throw new Error('not used') },
      async archive() { throw new Error('not used') },
    },
    groups: {
      async create() { throw new Error('not used') },
      async get(id) { return groups.find((value) => value.id === id) ?? null },
      async list() { return groups },
      async update() { throw new Error('not used') },
      async archive() { throw new Error('not used') },
      async addMember() { throw new Error('not used') },
      async removeMember() { throw new Error('not used') },
      async listMembers(groupId) { return memberships.filter((value) => value.groupId === groupId) },
      async listForUser(userId) {
        const ids = new Set(memberships.filter((value) => value.userId === userId).map(({ groupId }) => groupId))
        return groups.filter(({ id }) => ids.has(id))
      },
    },
    assignments: {
      async assignUser() { throw new Error('not used') },
      async revokeUser() { throw new Error('not used') },
      async listForUser(userId) { return userRoles.filter((value) => value.userId === userId) },
      async listUsersForRole(roleId) { return userRoles.filter((value) => value.roleId === roleId) },
      async assignGroup() { throw new Error('not used') },
      async revokeGroup() { throw new Error('not used') },
      async listForGroups(groupIds) { return groupRoles.filter((value) => groupIds.includes(value.groupId)) },
      async listGroupsForRole(roleId) { return groupRoles.filter((value) => value.roleId === roleId) },
    },
    resourceGrants: {
      async upsert(input) {
        const existing = grants.find((grant) => grant.resourceType === input.resourceType &&
          grant.resourceId === input.resourceId && grant.principalType === input.principalType &&
          grant.principalId === input.principalId)
        if (existing) {
          existing.accessRole = input.accessRole
          existing.updatedAt = Date.now()
          return existing
        }
        const grant = { ...input, createdAt: Date.now(), updatedAt: Date.now() }
        grants.push(grant)
        return grant
      },
      async remove(id) {
        const index = grants.findIndex((value) => value.id === id)
        if (index < 0) return false
        grants.splice(index, 1)
        return true
      },
      async listForResource({ resourceType, resourceId }) {
        return grants.filter((value) => value.resourceType === resourceType && value.resourceId === resourceId)
      },
      async listForPrincipals({ userId, groupIds, roleIds, resourceType }) {
        return grants.filter((value) => (!resourceType || value.resourceType === resourceType) && (
          (value.principalType === 'user' && value.principalId === userId) ||
          (value.principalType === 'group' && groupIds.includes(value.principalId)) ||
          (value.principalType === 'role' && roleIds.includes(value.principalId))
        ))
      },
    },
    resourceOwners: {
      async getOwner({ resourceType, resourceId }) {
        return owners.get(`${resourceType}:${resourceId}`) ?? null
      },
    },
  }
  const repositories = inMemoryKnowledgeRepositories()
  const authorization = new AuthorizationService({ repositories: authorizationRepositories })
  return {
    grants,
    groups,
    memberships,
    owners,
    repositories,
    service: new KnowledgeBaseService({
      authorization,
      authorizationRepositories,
      repositories,
    }),
  }
}

function inMemoryKnowledgeRepositories(): KnowledgeBaseRepositories {
  const bases = new Map<string, KnowledgeBase>()
  const sources = new Map<string, KnowledgeSource>()
  const versions = new Map<string, KnowledgeSourceVersion>()
  const memberships = new Map<string, KnowledgeBaseSource>()
  const conversations = new Map<string, KnowledgeBaseConversation>()
  let now = 1
  return {
    bases: {
      async create(input) {
        const value: KnowledgeBase = {
          ...input,
          kind: input.kind ?? 'personal',
          status: 'active',
          createdAt: now++,
          updatedAt: now++,
        }
        bases.set(value.id, value)
        return value
      },
      async get(id) { return bases.get(id) ?? null },
      async listForOwner(ownerUserId, options = {}) {
        return [...bases.values()].filter((value) => value.ownerUserId === ownerUserId &&
          (options.includeArchived || value.status === 'active'))
      },
      async update(input) {
        const current = bases.get(input.id)
        if (!current) return null
        const value = { ...current, ...defined(input), updatedAt: now++ }
        bases.set(value.id, value)
        return value
      },
      async archive(id) {
        const current = bases.get(id)
        if (!current) return false
        bases.set(id, { ...current, status: 'archived', archivedAt: now, updatedAt: now++ })
        return true
      },
      async remove(id) {
        if (!bases.delete(id)) return false
        for (const [key, value] of memberships) if (value.knowledgeBaseId === id) memberships.delete(key)
        for (const [key, value] of conversations) if (value.knowledgeBaseId === id) conversations.delete(key)
        return true
      },
    },
    sources: {
      async create(input) {
        const value: KnowledgeSource = {
          ...input,
          status: input.status ?? 'pending',
          metadata: input.metadata ?? {},
          createdAt: now++,
          updatedAt: now++,
        }
        sources.set(value.id, value)
        return value
      },
      async get(id) {
        const value = sources.get(id)
        return value && !value.deletedAt ? value : null
      },
      async update(input) {
        const current = sources.get(input.id)
        if (!current || current.deletedAt) return null
        const value = { ...current, ...defined(input), updatedAt: now++ }
        sources.set(value.id, value)
        return value
      },
      async markDeleted(id) {
        const current = sources.get(id)
        if (!current || current.deletedAt) return false
        sources.set(id, { ...current, status: 'deleting', deletedAt: now, updatedAt: now++ })
        return true
      },
      async createVersion(input) {
        const duplicate = [...versions.values()].find((value) => value.sourceId === input.sourceId &&
          value.contentHash === input.contentHash)
        if (duplicate) return duplicate
        const value = { ...input, createdAt: now++, updatedAt: now++ }
        versions.set(value.id, value)
        return value
      },
      async updateVersion(input) {
        const current = [...versions.values()].find((entry) => entry.id === input.id)
        if (!current) return null
        const updated = { ...current, ...input, updatedAt: Date.now() }
        versions.set(updated.id, updated)
        return updated
      },
      async listVersions(sourceId) { return [...versions.values()].filter((value) => value.sourceId === sourceId) },
    },
    memberships: {
      async add(input) {
        const key = `${input.knowledgeBaseId}:${input.sourceId}`
        const value = { ...input, createdAt: memberships.get(key)?.createdAt ?? now++ }
        memberships.set(key, value)
        return value
      },
      async remove(input) { return memberships.delete(`${input.knowledgeBaseId}:${input.sourceId}`) },
      async setEnabled(input) {
        const key = `${input.knowledgeBaseId}:${input.sourceId}`
        const current = memberships.get(key)
        if (!current) return false
        memberships.set(key, { ...current, enabled: input.enabled })
        return true
      },
      async listForBase(id) { return [...memberships.values()].filter((value) => value.knowledgeBaseId === id) },
      async listBasesForSource(id) { return [...memberships.values()].filter((value) => value.sourceId === id) },
    },
    conversations: {
      async attach(input) {
        const value = { ...input, createdAt: conversations.get(input.conversationId)?.createdAt ?? now++ }
        conversations.set(input.conversationId, value)
        return value
      },
      async detach(id) { return conversations.delete(id) },
      async getForConversation(id) { return conversations.get(id) ?? null },
      async listForBase(id) { return [...conversations.values()].filter((value) => value.knowledgeBaseId === id) },
    },
  }
}

function role(id: string, capabilities: AuthorizationRole['capabilities']): AuthorizationRole {
  return { id, name: id, capabilities, isSystem: false, createdAt: 1, updatedAt: 1 }
}

function assignment(userId: string, roleId: string): UserRoleAssignment {
  return { userId, roleId, createdAt: 1 }
}

function resourceGrant(
  id: string,
  resourceId: string,
  principalId: string,
  accessRole: ResourceGrant['accessRole'],
): ResourceGrant {
  return {
    id,
    resourceType: 'knowledge_base',
    resourceId,
    principalType: 'user',
    principalId,
    accessRole,
    createdAt: 1,
    updatedAt: 1,
  }
}

function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}
