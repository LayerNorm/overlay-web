import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  WorkspaceResourceGrant,
  WorkspaceShareResourceType,
  WorkspaceShareTargetType,
} from '@overlay/workspace-contracts'
import { WorkspaceSharingService, WorkspaceSharingServiceError } from './WorkspaceSharingService'
import type { UpsertWorkspaceResourceGrant, WorkspaceSharingRepository } from './WorkspaceSharingRepository'

const WORKSPACE = 'workspace_acme'
const OTHER_WORKSPACE = 'workspace_other'
const OWNER_USER = 'user_owner'
const OWNER_PRINCIPAL = 'principal_owner'
const MEMBER_USER = 'user_member'
const MEMBER_PRINCIPAL = 'principal_member'
const AGENT_PRINCIPAL = 'principal_agent'
const OUTSIDER_USER = 'user_outsider'
const TEAM = 'team_research'
const ROOM = 'conversation_research'

function fakeRepository(seed: WorkspaceResourceGrant[] = []) {
  const grants = [...seed]
  const repository: WorkspaceSharingRepository = {
    async upsert(input: UpsertWorkspaceResourceGrant) {
      const existingIndex = grants.findIndex((grant) => (
        grant.workspaceId === input.workspaceId
        && grant.resourceType === input.resourceType
        && grant.resourceId === input.resourceId
        && grant.targetType === input.targetType
        && grant.targetId === input.targetId
      ))
      const grant: WorkspaceResourceGrant = {
        id: existingIndex >= 0 ? grants[existingIndex]!.id : input.id,
        workspaceId: input.workspaceId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        targetType: input.targetType,
        targetId: input.targetId,
        accessRole: input.accessRole,
        grantedByPrincipalId: input.grantedByPrincipalId,
        createdAt: existingIndex >= 0 ? grants[existingIndex]!.createdAt : input.now,
        updatedAt: input.now,
      }
      if (existingIndex >= 0) grants[existingIndex] = grant
      else grants.push(grant)
      return grant
    },
    async remove({ grantId, workspaceId }) {
      const index = grants.findIndex((grant) => grant.id === grantId && grant.workspaceId === workspaceId)
      if (index < 0) return false
      grants.splice(index, 1)
      return true
    },
    async listForResource({ workspaceId, resourceType, resourceId }) {
      return grants.filter((grant) => (
        grant.workspaceId === workspaceId
        && grant.resourceType === resourceType
        && grant.resourceId === resourceId
      ))
    },
    async listForTargets({ workspaceId, resourceType, principalIds, teamIds, roomIds }) {
      const keys = new Set([
        ...principalIds.map((id) => `principal:${id}`),
        ...teamIds.map((id) => `team:${id}`),
        ...roomIds.map((id) => `room:${id}`),
      ])
      return grants.filter((grant) => (
        grant.workspaceId === workspaceId
        && (!resourceType || grant.resourceType === resourceType)
        && keys.has(`${grant.targetType}:${grant.targetId}`)
      ))
    },
  }
  return { repository, grants }
}

/**
 * Fakes model exactly the surface the service consumes, so the tests exercise
 * real authorization decisions rather than provider behavior.
 */
function createService(options: {
  seed?: WorkspaceResourceGrant[]
  resourceWorkspace?: string | null
  ownerUserId?: string | null
  publicLinksEnabled?: boolean
  agentCreatedBy?: string
} = {}) {
  const { repository, grants } = fakeRepository(options.seed)
  let scope = options.resourceWorkspace === undefined
    ? WORKSPACE
    : options.resourceWorkspace
  const members = [
    { principal: principal(OWNER_PRINCIPAL, 'human', 'Ada'), membership: membership(OWNER_PRINCIPAL, 'owner') },
    { principal: principal(MEMBER_PRINCIPAL, 'human', 'Maya'), membership: membership(MEMBER_PRINCIPAL, 'member') },
    { principal: principal(AGENT_PRINCIPAL, 'agent', 'Scout'), membership: membership(AGENT_PRINCIPAL, 'member') },
  ]
  const service = new WorkspaceSharingService({
    agents: {
      async get({ agentId, workspaceId }: { agentId: string; workspaceId: string }) {
        if (workspaceId !== WORKSPACE) return null
        return {
          id: agentId,
          createdByPrincipalId: options.agentCreatedBy ?? OWNER_PRINCIPAL,
        }
      },
    } as never,
    collaboration: {
      async listAccessibleConversationIds({ actorUserId }: { actorUserId: string }) {
        return actorUserId === OUTSIDER_USER ? [] : [ROOM]
      },
      async listParticipants() {
        return [
          {
            principalId: MEMBER_PRINCIPAL,
            principalType: 'human' as const,
            displayName: 'Maya',
            status: 'active' as const,
          },
          {
            principalId: AGENT_PRINCIPAL,
            principalType: 'agent' as const,
            displayName: 'Scout',
            status: 'active' as const,
          },
        ]
      },
    } as never,
    conversations: {
      async listConversations() {
        return [{ _id: ROOM, title: '#research', conversationType: 'channel' as const }]
      },
    } as never,
    repository,
    resourceOwners: {
      async getOwner() {
        return options.ownerUserId === undefined ? OWNER_USER : options.ownerUserId
      },
    },
    workspaceRepository: {
      async getResourceWorkspace() {
        return scope === null ? null : { workspaceId: scope, resourceType: 'file', resourceId: 'file_1', createdAt: 0, updatedAt: 0 }
      },
    } as never,
    workspaces: {
      async resolveActiveWorkspace(actorUserId: string, workspaceId: string) {
        if (actorUserId === OUTSIDER_USER) {
          throw new WorkspaceSharingServiceError('forbidden', 'Not a member of this workspace')
        }
        if (workspaceId && workspaceId !== WORKSPACE) {
          throw new WorkspaceSharingServiceError('not_found', 'Workspace not found')
        }
        const member = actorUserId === OWNER_USER ? members[0]! : members[1]!
        return {
          workspace: { id: WORKSPACE, kind: 'organization', name: 'Acme', slug: 'acme', status: 'active' },
          principal: member.principal,
          membership: member.membership,
        }
      },
      async listMembers() {
        return members
      },
      async listTeams() {
        return [{
          team: { id: TEAM, workspaceId: WORKSPACE, name: 'Research team', createdByPrincipalId: OWNER_PRINCIPAL, createdAt: 0, updatedAt: 0 },
          members: [
            { teamId: TEAM, workspaceId: WORKSPACE, principalId: MEMBER_PRINCIPAL, principalType: 'human' as const, createdAt: 0 },
            { teamId: TEAM, workspaceId: WORKSPACE, principalId: AGENT_PRINCIPAL, principalType: 'agent' as const, createdAt: 0 },
          ],
        }]
      },
      async bindResource() {
        scope = WORKSPACE
        return { workspaceId: WORKSPACE, resourceType: 'file', resourceId: 'file_1', createdAt: 0, updatedAt: 0 }
      },
      async getSharingPolicy() {
        return {
          workspaceId: WORKSPACE,
          publicLinksEnabled: options.publicLinksEnabled ?? true,
          updatedAt: 0,
        }
      },
    } as never,
    id: () => `grant_${grants.length + 1}`,
    now: () => 1_000,
  })
  return { service, grants }
}

function principal(id: string, type: 'human' | 'agent', displayName: string) {
  return { id, workspaceId: WORKSPACE, type, displayName, createdAt: 0, updatedAt: 0 }
}

function membership(principalId: string, role: 'owner' | 'member') {
  return { workspaceId: WORKSPACE, principalId, role, status: 'active' as const, joinedAt: 0, updatedAt: 0 }
}

function grantFixture(overrides: Partial<WorkspaceResourceGrant> = {}): WorkspaceResourceGrant {
  return {
    id: 'grant_seed',
    workspaceId: WORKSPACE,
    resourceType: 'file',
    resourceId: 'file_1',
    targetType: 'principal',
    targetId: MEMBER_PRINCIPAL,
    accessRole: 'viewer',
    grantedByPrincipalId: OWNER_PRINCIPAL,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const FILE = { resourceType: 'file' as WorkspaceShareResourceType, resourceId: 'file_1' }

test('only the resource owner can read or change who has access', async () => {
  const { service } = createService()
  await assert.rejects(
    () => service.getResourceShares({ actorUserId: MEMBER_USER, workspaceId: WORKSPACE, ...FILE }),
    (error: unknown) => error instanceof WorkspaceSharingServiceError && error.code === 'forbidden',
  )
  const response = await service.getResourceShares({
    actorUserId: OWNER_USER,
    workspaceId: WORKSPACE,
    ...FILE,
  })
  assert.equal(response.canManage, true)
  assert.equal(response.publicLinksEnabled, true)
})

test('the share response reports workspace public-link policy', async () => {
  const { service } = createService({ publicLinksEnabled: false })
  const response = await service.getResourceShares({
    actorUserId: OWNER_USER,
    workspaceId: WORKSPACE,
    ...FILE,
  })
  assert.equal(response.publicLinksEnabled, false)
})

test('a resource in another workspace is not shareable from this one', async () => {
  const { service } = createService({ resourceWorkspace: OTHER_WORKSPACE })
  await assert.rejects(
    () => service.getResourceShares({ actorUserId: OWNER_USER, workspaceId: WORKSPACE, ...FILE }),
    (error: unknown) => error instanceof WorkspaceSharingServiceError && error.code === 'not_found',
  )
})

test('sharing to a room requires explicit confirmation of dynamic expansion', async () => {
  const { service } = createService()
  const args = {
    actorUserId: OWNER_USER,
    workspaceId: WORKSPACE,
    resourceType: 'project' as WorkspaceShareResourceType,
    resourceId: 'project_1',
    targetType: 'room' as WorkspaceShareTargetType,
    targetId: ROOM,
    accessRole: 'viewer' as const,
  }
  await assert.rejects(
    () => service.upsertGrant(args),
    (error: unknown) => error instanceof WorkspaceSharingServiceError
      && error.code === 'confirmation_required',
  )
  const grant = await service.upsertGrant({ ...args, confirmRoomExpansion: true })
  assert.equal(grant.targetType, 'room')
})

test('run permission is rejected for resources that cannot be run', async () => {
  const { service } = createService()
  await assert.rejects(
    () => service.upsertGrant({
      actorUserId: OWNER_USER,
      workspaceId: WORKSPACE,
      ...FILE,
      targetType: 'principal',
      targetId: MEMBER_PRINCIPAL,
      accessRole: 'operator',
    }),
    (error: unknown) => error instanceof WorkspaceSharingServiceError && error.code === 'validation',
  )
})

test('unknown principals, teams, and rooms cannot receive grants', async () => {
  const { service } = createService()
  for (const target of [
    { targetType: 'principal' as const, targetId: 'principal_ghost' },
    { targetType: 'team' as const, targetId: 'team_ghost' },
    { targetType: 'room' as const, targetId: 'conversation_ghost' },
  ]) {
    await assert.rejects(
      () => service.upsertGrant({
        actorUserId: OWNER_USER,
        workspaceId: WORKSPACE,
        ...FILE,
        ...target,
        accessRole: 'viewer',
        confirmRoomExpansion: true,
      }),
      (error: unknown) => error instanceof WorkspaceSharingServiceError && error.code === 'not_found',
    )
  }
})

test('viewer, operator, and editor boundaries hold when access is checked', async () => {
  const cases = [
    { accessRole: 'viewer' as const, view: true, execute: false, edit: false },
    { accessRole: 'operator' as const, view: true, execute: true, edit: false },
    { accessRole: 'editor' as const, view: true, execute: true, edit: true },
  ]
  for (const testCase of cases) {
    const { service } = createService({
      seed: [grantFixture({
        resourceType: 'automation',
        resourceId: 'automation_1',
        accessRole: testCase.accessRole,
      })],
    })
    for (const [action, expected] of [
      ['view', testCase.view],
      ['execute', testCase.execute],
      ['edit', testCase.edit],
    ] as const) {
      const result = await service.checkAccess({
        action,
        actorUserId: MEMBER_USER,
        workspaceId: WORKSPACE,
        resourceType: 'automation',
        resourceId: 'automation_1',
      })
      assert.equal(result.allowed, expected, `${testCase.accessRole} ${action}`)
    }
  }
})

test('a share grant never confers delete or reshare', async () => {
  const { service } = createService({
    seed: [grantFixture({ accessRole: 'editor' })],
  })
  for (const action of ['delete', 'share'] as const) {
    const result = await service.checkAccess({
      action,
      actorUserId: MEMBER_USER,
      workspaceId: WORKSPACE,
      ...FILE,
    })
    assert.equal(result.allowed, false, action)
  }
})

test('team grants reach current team members dynamically', async () => {
  const { service } = createService({
    seed: [grantFixture({ targetType: 'team', targetId: TEAM, accessRole: 'editor' })],
  })
  const result = await service.checkAccess({
    action: 'edit',
    actorUserId: MEMBER_USER,
    workspaceId: WORKSPACE,
    ...FILE,
  })
  assert.equal(result.allowed, true)
  assert.equal(result.accessRole, 'editor')
})

test('a grant in another workspace never grants access here', async () => {
  const { service } = createService({
    seed: [grantFixture({ workspaceId: OTHER_WORKSPACE, accessRole: 'editor' })],
  })
  const result = await service.checkAccess({
    action: 'view',
    actorUserId: MEMBER_USER,
    workspaceId: WORKSPACE,
    ...FILE,
  })
  assert.equal(result.allowed, false)
})

test('a resource whose scope moved out of the workspace stops being readable', async () => {
  const { service } = createService({
    resourceWorkspace: OTHER_WORKSPACE,
    seed: [grantFixture({ accessRole: 'editor' })],
  })
  const result = await service.checkAccess({
    action: 'view',
    actorUserId: MEMBER_USER,
    workspaceId: WORKSPACE,
    ...FILE,
  })
  assert.equal(result.allowed, false)
})

test('grant impact discloses who gains access and who already had it', async () => {
  const { service } = createService({
    seed: [grantFixture({ targetId: MEMBER_PRINCIPAL, accessRole: 'viewer' })],
  })
  const impact = await service.previewGrantImpact({
    actorUserId: OWNER_USER,
    workspaceId: WORKSPACE,
    ...FILE,
    targetType: 'team',
    targetId: TEAM,
  })
  assert.equal(impact.targetName, 'Research team')
  assert.equal(impact.dynamic, true)
  assert.deepEqual(impact.gaining.map((principal) => principal.principalId), [AGENT_PRINCIPAL])
  assert.deepEqual(impact.retaining.map((principal) => principal.principalId), [MEMBER_PRINCIPAL])
})

test('revocation impact lists only principals who lose access outright', async () => {
  const { service } = createService({
    seed: [
      grantFixture({ id: 'grant_team', targetType: 'team', targetId: TEAM, accessRole: 'viewer' }),
      grantFixture({ id: 'grant_person', targetId: MEMBER_PRINCIPAL, accessRole: 'viewer' }),
    ],
  })
  const impact = await service.previewRevocationImpact({
    actorUserId: OWNER_USER,
    workspaceId: WORKSPACE,
    ...FILE,
    grantId: 'grant_team',
  })
  assert.deepEqual(impact.losing.map((principal) => principal.principalId), [AGENT_PRINCIPAL])
  assert.deepEqual(impact.retaining.map((principal) => principal.principalId), [MEMBER_PRINCIPAL])
})

test('revoking a grant removes access immediately', async () => {
  const { service, grants } = createService({
    seed: [grantFixture({ id: 'grant_person', accessRole: 'editor' })],
  })
  assert.equal((await service.checkAccess({
    action: 'edit',
    actorUserId: MEMBER_USER,
    workspaceId: WORKSPACE,
    ...FILE,
  })).allowed, true)
  await service.removeGrant({
    actorUserId: OWNER_USER,
    workspaceId: WORKSPACE,
    ...FILE,
    grantId: 'grant_person',
  })
  assert.equal(grants.length, 0)
  assert.equal((await service.checkAccess({
    action: 'edit',
    actorUserId: MEMBER_USER,
    workspaceId: WORKSPACE,
    ...FILE,
  })).allowed, false)
})

test('revoking a grant that belongs to another resource is not found', async () => {
  const { service } = createService({
    seed: [grantFixture({ id: 'grant_other', resourceId: 'file_2' })],
  })
  await assert.rejects(
    () => service.removeGrant({
      actorUserId: OWNER_USER,
      workspaceId: WORKSPACE,
      ...FILE,
      grantId: 'grant_other',
    }),
    (error: unknown) => error instanceof WorkspaceSharingServiceError && error.code === 'not_found',
  )
})

test('shared resources appear in accessible listings only for permitted actions', async () => {
  const { service } = createService({
    seed: [grantFixture({
      resourceType: 'automation',
      resourceId: 'automation_1',
      accessRole: 'operator',
    })],
  })
  const runnable = await service.listAccessibleResources({
    action: 'execute',
    actorUserId: MEMBER_USER,
    workspaceId: WORKSPACE,
    resourceType: 'automation',
  })
  assert.deepEqual(runnable.map((item) => item.resourceId), ['automation_1'])
  const editable = await service.listAccessibleResources({
    action: 'edit',
    actorUserId: MEMBER_USER,
    workspaceId: WORKSPACE,
    resourceType: 'automation',
  })
  assert.deepEqual(editable, [])
})

test('an outsider cannot preview, list, or check anything in the workspace', async () => {
  const { service } = createService({ seed: [grantFixture({ accessRole: 'editor' })] })
  await assert.rejects(() => service.getResourceShares({
    actorUserId: OUTSIDER_USER,
    workspaceId: WORKSPACE,
    ...FILE,
  }))
  await assert.rejects(() => service.checkAccess({
    action: 'view',
    actorUserId: OUTSIDER_USER,
    workspaceId: WORKSPACE,
    ...FILE,
  }))
})

test('agents are shareable by workspace admins even when someone else created them', async () => {
  const { service } = createService({
    ownerUserId: null,
    agentCreatedBy: MEMBER_PRINCIPAL,
  })
  const grant = await service.upsertGrant({
    actorUserId: OWNER_USER,
    workspaceId: WORKSPACE,
    resourceType: 'agent',
    resourceId: 'agent_1',
    targetType: 'principal',
    targetId: MEMBER_PRINCIPAL,
    accessRole: 'operator',
  })
  assert.equal(grant.accessRole, 'operator')
})
