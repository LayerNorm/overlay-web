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

test('invitation acceptance preserves expired, email mismatch, and consumed states', async () => {
  const outcomes = ['expired', 'email_mismatch', 'not_pending'] as const
  let index = 0
  const service = new WorkspaceService(repository({
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
