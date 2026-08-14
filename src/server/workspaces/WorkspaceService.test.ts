import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  WorkspaceAccess,
  WorkspacePrincipal,
} from '@overlay/workspace-contracts'
import type { WorkspaceRepository } from './WorkspaceRepository'
import { WorkspaceService, WorkspaceServiceError } from './WorkspaceService'
import { LifecycleEventPublisher } from '@/server/lifecycle-events'

function access(overrides: {
  userId?: string
  workspaceId?: string
  role?: WorkspaceAccess['membership']['role']
  status?: WorkspaceAccess['membership']['status']
  workspaceStatus?: WorkspaceAccess['workspace']['status']
  personalOwnerUserId?: string
} = {}): WorkspaceAccess {
  const workspaceId = overrides.workspaceId ?? 'workspace_personal'
  const userId = overrides.userId ?? 'user_1'
  return {
    workspace: {
      id: workspaceId,
      kind: workspaceId.includes('personal') ? 'personal' : 'organization',
      name: workspaceId.includes('personal') ? 'Personal' : 'Acme',
      slug: workspaceId,
      status: overrides.workspaceStatus ?? 'active',
      createdByPrincipalId: `principal_${overrides.personalOwnerUserId ?? userId}`,
      createdAt: 1,
      updatedAt: 1,
    },
    principal: {
      id: `principal_${userId}`,
      workspaceId,
      type: 'human',
      userId,
      displayName: userId,
      createdAt: 1,
      updatedAt: 1,
    },
    membership: {
      workspaceId,
      principalId: `principal_${userId}`,
      role: overrides.role ?? 'owner',
      status: overrides.status ?? 'active',
      joinedAt: 1,
      updatedAt: 1,
    },
  }
}

function repository(
  methods: Partial<WorkspaceRepository>,
): WorkspaceRepository {
  // Policy reads are ambient: every workspace has one, and an absent row means
  // the documented defaults, so the fake answers unless a test overrides it.
  const withPolicy: Partial<WorkspaceRepository> = {
    getSharingPolicy: async () => null,
    ...methods,
  }
  return new Proxy(withPolicy as WorkspaceRepository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (value !== undefined) return value
      return async () => {
        throw new Error(`Unexpected repository call: ${String(property)}`)
      }
    },
  })
}

function assertServiceError(
  error: unknown,
  expected: WorkspaceServiceError['code'],
): boolean {
  return error instanceof WorkspaceServiceError && error.code === expected
}

test('resolveActiveWorkspace persists a usable fallback and rejects inaccessible selectors', async () => {
  const fallback = access({ workspaceId: 'workspace_org' })
  const selections: string[] = []
  const service = new WorkspaceService(repository({
    async getActiveWorkspace() {
      return null
    },
    async listForUser() {
      return [fallback]
    },
    async setActiveWorkspace(args) {
      selections.push(args.workspaceId)
      return args.workspaceId === fallback.workspace.id ? fallback : null
    },
    async getAccess() {
      return null
    },
  }), { now: () => 10 })

  assert.equal((await service.resolveActiveWorkspace('user_1')).workspace.id, 'workspace_org')
  assert.deepEqual(selections, ['workspace_org'])
  await assert.rejects(
    () => service.resolveActiveWorkspace('user_1', 'workspace_other'),
    (error) => assertServiceError(error, 'not_found'),
  )
})

test('Personal access is limited to its creating principal', async () => {
  const invitedMember = access({
    userId: 'user_2',
    role: 'member',
    personalOwnerUserId: 'user_1',
  })
  const service = new WorkspaceService(repository({
    async getAccess() { return invitedMember },
  }))

  await assert.rejects(
    () => service.resolveActiveWorkspace('user_2', invitedMember.workspace.id),
    (error) => assertServiceError(error, 'not_found'),
  )
})

test('syncHumanPrincipalProfile replaces bootstrap ids with the canonical account name', async () => {
  const current = access({ workspaceId: 'workspace_org', userId: 'user_01KJR9' })
  let updatedName = ''
  const service = new WorkspaceService(repository({
    async getAccess() { return current },
    async updatePrincipal(args) {
      updatedName = args.displayName ?? ''
      return { ...current.principal, displayName: updatedName, email: args.email }
    },
  }), { now: () => 10 })

  const principal = await service.syncHumanPrincipalProfile({
    userId: current.principal.userId!,
    workspaceId: current.workspace.id,
    displayName: 'Divyansh Lalwani',
    email: 'dslalwani@gmail.com',
  })
  assert.equal(updatedName, 'Divyansh Lalwani')
  assert.equal(principal.displayName, 'Divyansh Lalwani')
})

test('legacy resources are claimed only by Personal and existing bindings never move', async () => {
  const bindings = new Map<string, string>([['already_bound', 'workspace_acme']])
  const bound: string[] = []
  const personal = access({ workspaceId: 'workspace_personal' })
  const service = new WorkspaceService(repository({
    async getAccess() { return personal },
    async getResourceWorkspace({ resourceId }) {
      const workspaceId = bindings.get(resourceId)
      return workspaceId
        ? { workspaceId, resourceType: 'knowledge_base', resourceId, createdAt: 1, updatedAt: 1 }
        : null
    },
    async bindResource(input) {
      bindings.set(input.resourceId, input.workspaceId)
      bound.push(input.resourceId)
      return { ...input, createdAt: input.now, updatedAt: input.now }
    },
  }), { now: () => 10 })

  assert.deepEqual(await service.bindUnscopedResourcesToPersonalWorkspace({
    actorUserId: 'user_1',
    workspaceId: personal.workspace.id,
    resourceType: 'knowledge_base',
    resourceIds: ['legacy_one', 'already_bound', 'legacy_one'],
  }), ['legacy_one'])
  assert.deepEqual(bound, ['legacy_one'])
  assert.equal(bindings.get('already_bound'), 'workspace_acme')

  const organization = access({ workspaceId: 'workspace_acme' })
  const organizationService = new WorkspaceService(repository({
    async getAccess() { return organization },
  }))
  assert.deepEqual(await organizationService.bindUnscopedResourcesToPersonalWorkspace({
    actorUserId: 'user_1',
    workspaceId: organization.workspace.id,
    resourceType: 'knowledge_base',
    resourceIds: ['unbound'],
  }), [])
})

test('workspace management is role-gated and final-owner failures remain explicit', async () => {
  const memberAccess = access({ workspaceId: 'workspace_org', role: 'member' })
  const ownerAccess = access({ workspaceId: 'workspace_org', role: 'owner' })
  let current = memberAccess
  const service = new WorkspaceService(repository({
    async getAccess() {
      return current
    },
    async createInvitationReplacingPending() {
      throw new Error('must not invite without manager role')
    },
    async setMembershipRole() {
      return { status: 'last_owner' }
    },
    async getMembership() {
      return ownerAccess.membership
    },
  }))

  await assert.rejects(
    () => service.invite({
      actorUserId: 'user_1',
      workspaceId: 'workspace_org',
      email: 'new@example.com',
      role: 'member',
    }),
    (error) => assertServiceError(error, 'forbidden'),
  )

  current = ownerAccess
  await assert.rejects(
    () => service.setMembershipRole({
      actorUserId: 'user_1',
      workspaceId: 'workspace_org',
      principalId: ownerAccess.principal.id,
      role: 'member',
    }),
    (error) => assertServiceError(error, 'last_owner'),
  )
})

test('Personal rejects collaboration while preserving private agents and agent chats', async () => {
  const personal = access()
  const agent: WorkspacePrincipal = {
    id: 'principal_agent',
    workspaceId: personal.workspace.id,
    type: 'agent',
    agentId: 'agent_1',
    displayName: 'Scout',
    createdAt: 1,
    updatedAt: 1,
  }
  const teammate: WorkspacePrincipal = {
    id: 'principal_teammate',
    workspaceId: personal.workspace.id,
    type: 'human',
    userId: 'user_2',
    displayName: 'Teammate',
    createdAt: 1,
    updatedAt: 1,
  }
  const service = new WorkspaceService(repository({
    async getAccess() { return personal },
    async getPrincipal(principalId) {
      if (principalId === agent.id) return agent
      if (principalId === teammate.id) return teammate
      return null
    },
    async listPrincipals() {
      return [personal.principal, teammate, agent]
    },
    async listMemberships() {
      return [
        personal.membership,
        { ...personal.membership, principalId: teammate.id, role: 'member' },
        { ...personal.membership, principalId: agent.id, role: 'member' },
      ]
    },
    async createPrincipal(input) {
      return {
        id: input.id,
        workspaceId: input.workspaceId,
        type: input.type,
        agentId: input.agentId,
        serviceId: input.serviceId,
        displayName: input.displayName,
        createdAt: input.now,
        updatedAt: input.now,
      }
    },
  }), { createId: () => 'principal_new_agent', now: () => 10 })

  for (const operation of [
    () => service.invite({
      actorUserId: 'user_1',
      workspaceId: personal.workspace.id,
      email: 'teammate@example.com',
      role: 'member',
    }),
    () => service.createTeam({
      actorUserId: 'user_1',
      workspaceId: personal.workspace.id,
      name: 'Product',
    }),
    () => service.setSharingPolicy({
      actorUserId: 'user_1',
      workspaceId: personal.workspace.id,
      patch: { memberCanInvite: true },
    }),
    () => service.assertDirectMessageParticipantsAllowed({
      actorUserId: 'user_1',
      workspaceId: personal.workspace.id,
      principalIds: [teammate.id],
    }),
  ]) {
    await assert.rejects(
      operation,
      (error) => assertServiceError(error, 'personal_workspace_not_collaborative')
        && (error as WorkspaceServiceError).statusCode === 409,
    )
  }

  await service.assertDirectMessageParticipantsAllowed({
    actorUserId: 'user_1',
    workspaceId: personal.workspace.id,
    principalIds: [agent.id],
  })
  assert.deepEqual(
    (await service.listMembers({
      actorUserId: 'user_1',
      workspaceId: personal.workspace.id,
    })).map((member) => member.principal.id),
    [personal.principal.id],
  )
  const created = await service.createPrincipal({
    actorUserId: 'user_1',
    workspaceId: personal.workspace.id,
    type: 'agent',
    agentId: 'agent_new',
    displayName: 'Private agent',
  })
  assert.equal(created.type, 'agent')
})

test('invitation acceptance preserves expired, email mismatch, and consumed states', async () => {
  const outcomes = ['expired', 'email_mismatch', 'not_pending'] as const
  let index = 0
  const service = new WorkspaceService(repository({
    async getInvitation() {
      return null
    },
    async acceptInvitation() {
      return { status: outcomes[index++]! }
    },
  }))

  await assert.rejects(
    () => service.acceptInvitation({
      invitationId: 'invite_1',
      userId: 'user_2',
      email: 'person@example.com',
    }),
    (error) => assertServiceError(error, 'invitation_expired'),
  )
  await assert.rejects(
    () => service.acceptInvitation({
      invitationId: 'invite_1',
      userId: 'user_2',
      email: 'wrong@example.com',
    }),
    (error) => assertServiceError(error, 'invitation_invalid')
      && (error as WorkspaceServiceError).statusCode === 403,
  )
  await assert.rejects(
    () => service.acceptInvitation({
      invitationId: 'invite_1',
      userId: 'user_2',
      email: 'person@example.com',
    }),
    (error) => assertServiceError(error, 'invitation_invalid')
      && (error as WorkspaceServiceError).statusCode === 409,
  )
})

test('an old Personal invitation cannot be accepted', async () => {
  const personal = access()
  const invitation = {
    id: 'invite_personal',
    workspaceId: personal.workspace.id,
    email: 'person@example.com',
    role: 'member' as const,
    status: 'pending' as const,
    invitedByPrincipalId: personal.principal.id,
    expiresAt: 100,
    createdAt: 1,
    updatedAt: 1,
  }
  const service = new WorkspaceService(repository({
    async getInvitation() { return invitation },
    async getWorkspace() { return personal.workspace },
  }))

  await assert.rejects(
    () => service.acceptInvitation({
      invitationId: invitation.id,
      userId: 'user_2',
      email: invitation.email,
    }),
    (error) => assertServiceError(error, 'personal_workspace_not_collaborative'),
  )
})

test('resending an invitation publishes a fresh delivery event for the replacement', async () => {
  const actor = access({ workspaceId: 'workspace_org', role: 'owner' })
  const events: unknown[] = []
  const existing = {
    id: 'invite_old',
    workspaceId: actor.workspace.id,
    email: 'new.member@example.com',
    role: 'member' as const,
    status: 'pending' as const,
    invitedByPrincipalId: actor.principal.id,
    expiresAt: 100,
    createdAt: 1,
    updatedAt: 1,
  }
  const replacement = { ...existing, id: 'invite_new', expiresAt: 200, updatedAt: 50 }
  const service = new WorkspaceService(repository({
    async getAccess() {
      return actor
    },
    async getInvitation() {
      return existing
    },
    async createInvitationReplacingPending() {
      return replacement
    },
  }), {
    createId: () => 'invite_new',
    now: () => 50,
    invitationTtlMs: 150,
    lifecycleEvents: new LifecycleEventPublisher({
      eventBus: {
        async publish(_topic, payload) { events.push(payload) },
        subscribe() { return () => {} },
      },
    }),
  })

  const result = await service.resendInvitation({
    actorUserId: 'user_1',
    workspaceId: actor.workspace.id,
    invitationId: existing.id,
  })

  assert.equal(result.id, 'invite_new')
  assert.equal(events.length, 1)
  assert.equal((events[0] as { idempotencyKey?: string }).idempotencyKey, 'workspace.invitation_sent:invite_new')
  assert.equal(
    (events[0] as { attributes?: { invitedEmail?: string } }).attributes?.invitedEmail,
    'new.member@example.com',
  )
})

test('teams accept human and agent principals but reject services and cross-workspace principals', async () => {
  const actor = access({ workspaceId: 'workspace_org', role: 'member' })
  const principal = (type: WorkspacePrincipal['type'], workspaceId = 'workspace_org'): WorkspacePrincipal => ({
    id: `principal_${type}`,
    workspaceId,
    type,
    ...(type === 'human'
      ? { userId: 'user_2' }
      : type === 'agent'
        ? { agentId: 'agent_1' }
        : { serviceId: 'service_1' }),
    displayName: type,
    createdAt: 1,
    updatedAt: 1,
  })
  let selected = principal('service')
  const service = new WorkspaceService(repository({
    async getAccess() {
      return actor
    },
    async getTeam() {
      return {
        id: 'team_1',
        workspaceId: 'workspace_org',
        name: 'Product',
        createdByPrincipalId: actor.principal.id,
        createdAt: 1,
        updatedAt: 1,
      }
    },
    async getPrincipal() {
      return selected
    },
    async addTeamMember(input) {
      return {
        teamId: input.teamId,
        workspaceId: input.workspaceId,
        principalId: input.principalId,
        principalType: input.principalType,
        createdAt: input.now,
      }
    },
  }), { now: () => 50 })

  await assert.rejects(
    () => service.addTeamMember({
      actorUserId: 'user_1',
      workspaceId: 'workspace_org',
      teamId: 'team_1',
      principalId: selected.id,
    }),
    (error) => assertServiceError(error, 'validation'),
  )

  selected = principal('agent')
  assert.equal(
    (await service.addTeamMember({
      actorUserId: 'user_1',
      workspaceId: 'workspace_org',
      teamId: 'team_1',
      principalId: selected.id,
    })).principalType,
    'agent',
  )

  selected = principal('human', 'workspace_other')
  await assert.rejects(
    () => service.addTeamMember({
      actorUserId: 'user_1',
      workspaceId: 'workspace_org',
      teamId: 'team_1',
      principalId: selected.id,
    }),
    (error) => assertServiceError(error, 'not_found'),
  )
})

test('personal workspaces cannot be archived and organization ownership targets must be active humans', async () => {
  let actor = access()
  const service = new WorkspaceService(repository({
    async getAccess() {
      return actor
    },
    async transferOwnership() {
      return { status: 'target_not_human' }
    },
  }))

  await assert.rejects(
    () => service.archiveWorkspace({
      actorUserId: 'user_1',
      workspaceId: actor.workspace.id,
    }),
    (error) => assertServiceError(error, 'validation'),
  )

  actor = access({ workspaceId: 'workspace_org' })
  await assert.rejects(
    () => service.transferOwnership({
      actorUserId: 'user_1',
      workspaceId: actor.workspace.id,
      toPrincipalId: 'principal_agent',
    }),
    (error) => assertServiceError(error, 'validation'),
  )
})

test('account deletion requires transfer from the final active organization owner', async () => {
  const owner = access({ workspaceId: 'workspace_org', role: 'owner' })
  let memberships = [owner.membership]
  const service = new WorkspaceService(repository({
    async listForUser() {
      return [access(), owner]
    },
    async listMemberships() {
      return memberships
    },
  }))

  await assert.rejects(
    () => service.assertAccountDeletionAllowed('user_1'),
    (error) => assertServiceError(error, 'last_owner')
      && /Transfer ownership of Acme/.test((error as Error).message),
  )

  memberships = [
    owner.membership,
    {
      ...owner.membership,
      principalId: 'principal_user_2',
      role: 'owner',
    },
  ]
  await service.assertAccountDeletionAllowed('user_1')
})

test('resource scopes fail closed across workspace boundaries', async () => {
  const orgAccess = access({ workspaceId: 'workspace_org', role: 'member' })
  const scope = {
    workspaceId: 'workspace_other',
    resourceType: 'project',
    resourceId: 'project_1',
    createdAt: 1,
    updatedAt: 1,
  }
  const service = new WorkspaceService(repository({
    async getAccess() {
      return orgAccess
    },
    async getResourceWorkspace() {
      return scope
    },
  }))

  await assert.rejects(
    () => service.assertResourceWorkspace({
      actorUserId: 'user_1',
      workspaceId: orgAccess.workspace.id,
      resourceType: scope.resourceType,
      resourceId: scope.resourceId,
    }),
    (error) => assertServiceError(error, 'not_found'),
  )
})

test('invite rejects an active member but allows re-inviting a removed member', async () => {
  const actor = access({ workspaceId: 'workspace_org', role: 'owner' })
  const activeMember = {
    id: 'principal_user_2',
    workspaceId: actor.workspace.id,
    type: 'human' as const,
    userId: 'user_2',
    email: 'removed@example.com',
    displayName: 'Removed Member',
    createdAt: 1,
    updatedAt: 1,
  }
  const activeMembership = {
    workspaceId: actor.workspace.id,
    principalId: 'principal_user_2',
    role: 'member' as const,
    status: 'active' as const,
    joinedAt: 1,
    updatedAt: 1,
  }
  const invitation = {
    id: 'invite_new',
    workspaceId: actor.workspace.id,
    email: 'removed@example.com',
    role: 'member' as const,
    status: 'pending' as const,
    invitedByPrincipalId: actor.principal.id,
    expiresAt: 200,
    createdAt: 50,
    updatedAt: 50,
  }

  // Active member: principal exists AND has an active membership → reject.
  const serviceWithActiveMember = new WorkspaceService(repository({
    async getAccess() { return actor },
    async listPrincipals() { return [activeMember] },
    async listMemberships() { return [activeMembership] },
    async createInvitationReplacingPending() {
      throw new Error('must not invite an active member')
    },
  }), { now: () => 50, createId: () => 'invite_new' })

  await assert.rejects(
    () => serviceWithActiveMember.invite({
      actorUserId: 'user_1',
      workspaceId: actor.workspace.id,
      email: 'removed@example.com',
      role: 'member',
    }),
    (error) => assertServiceError(error, 'conflict'),
  )

  // Removed member: principal still exists but no active membership → allow.
  const serviceWithRemovedMember = new WorkspaceService(repository({
    async getAccess() { return actor },
    async listPrincipals() { return [activeMember] },
    async listMemberships() { return [] },
    async createInvitationReplacingPending() { return invitation },
  }), { now: () => 50, createId: () => 'invite_new' })

  const result = await serviceWithRemovedMember.invite({
    actorUserId: 'user_1',
    workspaceId: actor.workspace.id,
    email: 'removed@example.com',
    role: 'member',
  })
  assert.equal(result.id, 'invite_new')
})
