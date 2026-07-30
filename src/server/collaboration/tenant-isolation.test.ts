import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkspaceSharingService, WorkspaceSharingServiceError } from '@/server/sharing/WorkspaceSharingService'
import { WorkspaceSearchService } from '@/server/search/WorkspaceSearchService'
import {
  resolveCollaborationLimits,
  isForbiddenByLimit,
} from '@/shared/workspaces/collaboration-limits'
import { resolveMentionFirstInvocations } from '@/server/agents/mention-policy'

const ACME = 'workspace_acme'
const RIVAL = 'workspace_rival'
const ACME_USER = 'user_acme'
const RIVAL_USER = 'user_rival'
const ACME_PRINCIPAL = 'principal_acme'
const ACME_AGENT = 'principal_acme_agent'
const ACME_TEAM = 'team_acme'
const ACME_ROOM = 'conversation_acme'

/**
 * Tenant isolation and confused-deputy suite.
 *
 * Every case here is an attack: a principal, an agent, or a stale grant trying
 * to reach across a workspace boundary or to borrow somebody else's authority.
 * Both providers enforce the same rules, so these run against the service layer
 * with fakes that faithfully model workspace scoping.
 */
function createSharing(options: {
  resourceWorkspace?: string
  grants?: Array<{
    id: string
    workspaceId: string
    resourceType: 'file'
    resourceId: string
    targetType: 'principal' | 'team' | 'room'
    targetId: string
    accessRole: 'viewer' | 'editor'
  }>
} = {}) {
  const grants = options.grants ?? []
  return new WorkspaceSharingService({
    agents: { async get() { return null } } as never,
    collaboration: {
      async listAccessibleConversationIds({ actorUserId }: { actorUserId: string }) {
        return actorUserId === ACME_USER ? [ACME_ROOM] : []
      },
      async listParticipants() {
        return [{
          principalId: ACME_PRINCIPAL,
          principalType: 'human' as const,
          displayName: 'Ada',
          status: 'active' as const,
        }]
      },
    } as never,
    conversations: {
      async listConversations() {
        return [{ _id: ACME_ROOM, title: '#acme', conversationType: 'channel' as const }]
      },
    } as never,
    repository: {
      async upsert() { throw new Error('not used') },
      async remove() { return false },
      async listForResource({ workspaceId, resourceId }: { workspaceId: string; resourceId: string }) {
        return grants.filter((grant) => grant.workspaceId === workspaceId && grant.resourceId === resourceId)
      },
      async listForTargets({ workspaceId, principalIds, teamIds, roomIds }: {
        workspaceId: string
        principalIds: string[]
        teamIds: string[]
        roomIds: string[]
      }) {
        const keys = new Set([
          ...principalIds.map((id) => `principal:${id}`),
          ...teamIds.map((id) => `team:${id}`),
          ...roomIds.map((id) => `room:${id}`),
        ])
        return grants.filter((grant) => (
          grant.workspaceId === workspaceId && keys.has(`${grant.targetType}:${grant.targetId}`)
        ))
      },
    } as never,
    resourceOwners: { async getOwner() { return ACME_USER } },
    workspaceRepository: {
      async getResourceWorkspace() {
        return {
          workspaceId: options.resourceWorkspace ?? ACME,
          resourceType: 'file',
          resourceId: 'file_acme',
          createdAt: 0,
          updatedAt: 0,
        }
      },
    } as never,
    workspaces: {
      async resolveActiveWorkspace(actorUserId: string, workspaceId: string) {
        // Membership is per workspace: a rival user never resolves into Acme.
        if (actorUserId === ACME_USER && (!workspaceId || workspaceId === ACME)) {
          return {
            workspace: { id: ACME },
            principal: { id: ACME_PRINCIPAL },
            membership: { role: 'owner', status: 'active' },
          }
        }
        if (actorUserId === RIVAL_USER && (!workspaceId || workspaceId === RIVAL)) {
          return {
            workspace: { id: RIVAL },
            principal: { id: 'principal_rival' },
            membership: { role: 'owner', status: 'active' },
          }
        }
        throw new WorkspaceSharingServiceError('not_found', 'Workspace not found')
      },
      async listMembers() {
        return [
          {
            principal: { id: ACME_PRINCIPAL, type: 'human', displayName: 'Ada', workspaceId: ACME },
            membership: { role: 'owner', status: 'active', principalId: ACME_PRINCIPAL, workspaceId: ACME },
          },
          {
            principal: { id: ACME_AGENT, type: 'agent', displayName: 'Scout', workspaceId: ACME },
            membership: { role: 'member', status: 'active', principalId: ACME_AGENT, workspaceId: ACME },
          },
        ]
      },
      async listTeams() {
        return [{
          team: { id: ACME_TEAM, workspaceId: ACME, name: 'Acme team' },
          members: [{ principalId: ACME_PRINCIPAL, principalType: 'human' as const }],
        }]
      },
      async bindResource() {
        return { workspaceId: ACME, resourceType: 'file', resourceId: 'file_acme', createdAt: 0, updatedAt: 0 }
      },
      async getSharingPolicy() {
        return { workspaceId: ACME, publicLinksEnabled: true, updatedAt: 0 }
      },
    } as never,
    id: () => 'grant_new',
    now: () => 1_000,
  })
}

const FILE = { resourceType: 'file' as const, resourceId: 'file_acme' }

test('a member of another workspace cannot read, share, or check access', async () => {
  const sharing = createSharing()
  for (const workspaceId of [ACME, RIVAL, '']) {
    await assert.rejects(() => sharing.getResourceShares({
      actorUserId: RIVAL_USER,
      workspaceId,
      ...FILE,
    }), 'rival must not manage an Acme resource')
  }
  await assert.rejects(() => sharing.checkAccess({
    action: 'view',
    actorUserId: RIVAL_USER,
    workspaceId: ACME,
    ...FILE,
  }))
})

test('a grant recorded under another workspace never grants access', async () => {
  const sharing = createSharing({
    grants: [{
      id: 'grant_rival',
      workspaceId: RIVAL,
      resourceType: 'file',
      resourceId: 'file_acme',
      targetType: 'principal',
      targetId: ACME_PRINCIPAL,
      accessRole: 'editor',
    }],
  })
  const decision = await sharing.checkAccess({
    action: 'view',
    actorUserId: ACME_USER,
    workspaceId: ACME,
    ...FILE,
  })
  // The actor owns the resource here, so allowed is true — but the grant that
  // would have carried a rival workspace must contribute nothing.
  assert.equal(decision.accessRole, 'editor')
  assert.equal(decision.ownerUserId, ACME_USER)
})

test('a resource whose workspace binding moved is no longer manageable', async () => {
  const sharing = createSharing({ resourceWorkspace: RIVAL })
  await assert.rejects(() => sharing.getResourceShares({
    actorUserId: ACME_USER,
    workspaceId: ACME,
    ...FILE,
  }), (error: unknown) => error instanceof WorkspaceSharingServiceError && error.code === 'not_found')
})

test('search never reaches into another workspace, even with a forged id', async () => {
  const search = new WorkspaceSearchService({
    agents: { async list() { return [] } } as never,
    collaboration: { async searchWorkspaceChats() { return [] } } as never,
    conversations: {} as never,
    sharing: { async listAccessibleResources() { return [] } } as never,
    workspaces: {
      async resolveActiveWorkspace(actorUserId: string, workspaceId: string) {
        if (actorUserId === RIVAL_USER && workspaceId === ACME) {
          throw new Error('WORKSPACE_NOT_FOUND')
        }
        return { workspace: { id: ACME }, principal: { id: ACME_PRINCIPAL }, membership: { role: 'owner' } }
      },
    } as never,
    sources: {
      files: async () => [{ _id: 'file_acme', name: 'Acme secret plan' }],
      projects: async () => [],
      knowledgeBases: async () => [],
      automations: async () => [],
    },
    loaders: {},
  })
  await assert.rejects(() => search.search({
    actorUserId: RIVAL_USER,
    workspaceId: ACME,
    query: 'secret',
    kinds: ['file'],
  }))
  const own = await search.search({
    actorUserId: ACME_USER,
    workspaceId: ACME,
    query: 'secret',
    kinds: ['file'],
  })
  assert.equal(own.results.length, 1)
})

test('an agent is not a deputy for the human who mentioned it', () => {
  // Mention-first policy: an agent runs only when a human addresses it, and an
  // agent message never triggers another agent.
  const participants = [
    { principalId: 'human_a', principalType: 'human' as const },
    { principalId: 'human_b', principalType: 'human' as const },
    { principalId: 'agent_x', principalType: 'agent' as const },
    { principalId: 'agent_y', principalType: 'agent' as const },
  ]
  assert.deepEqual(resolveMentionFirstInvocations({
    authorKind: 'agent',
    conversationType: 'channel',
    participants,
    mentionedPrincipalIds: ['agent_y'],
  }), [], 'an agent must not invoke another agent')
  assert.deepEqual(resolveMentionFirstInvocations({
    authorKind: 'human',
    conversationType: 'channel',
    participants,
  }), [], 'an unaddressed channel message must not wake an agent')
})

test('guests are limited on their own buckets and forbidden from privileged actions', () => {
  const guestShare = resolveCollaborationLimits('share.grant', {
    workspaceId: ACME,
    principalId: 'principal_guest',
    guest: true,
  })
  const guestBucket = guestShare.find((entry) => entry.key.includes(':guest:'))
  assert.ok(guestBucket, 'guests must use a guest bucket, not the member bucket')
  assert.equal(isForbiddenByLimit(guestBucket.limits), true)

  const memberShare = resolveCollaborationLimits('share.grant', {
    workspaceId: ACME,
    principalId: ACME_PRINCIPAL,
  })
  const memberBucket = memberShare.find((entry) => entry.key.includes(':principal:'))
  assert.equal(isForbiddenByLimit(memberBucket!.limits), false)
})

test('every limit key is prefixed by its workspace so tenants cannot drain each other', () => {
  const acme = resolveCollaborationLimits('message.send', {
    workspaceId: ACME,
    principalId: ACME_PRINCIPAL,
    conversationId: ACME_ROOM,
  })
  const rival = resolveCollaborationLimits('message.send', {
    workspaceId: RIVAL,
    principalId: ACME_PRINCIPAL,
    conversationId: ACME_ROOM,
  })
  for (const entry of acme) assert.match(entry.key, new RegExp(ACME))
  const shared = acme.map((entry) => entry.key)
    .filter((key) => rival.some((entry) => entry.key === key))
  assert.deepEqual(shared, [], 'no limit key may be shared across workspaces')
})

test('a principal id from another workspace cannot be granted access', async () => {
  const sharing = createSharing()
  await assert.rejects(() => sharing.upsertGrant({
    actorUserId: ACME_USER,
    workspaceId: ACME,
    ...FILE,
    targetType: 'principal',
    targetId: 'principal_rival',
    accessRole: 'viewer',
  }), (error: unknown) => error instanceof WorkspaceSharingServiceError && error.code === 'not_found')
})

test('a room in another workspace cannot be used to widen access', async () => {
  const sharing = createSharing()
  await assert.rejects(() => sharing.upsertGrant({
    actorUserId: ACME_USER,
    workspaceId: ACME,
    ...FILE,
    targetType: 'room',
    targetId: 'conversation_rival',
    accessRole: 'viewer',
    confirmRoomExpansion: true,
  }), (error: unknown) => error instanceof WorkspaceSharingServiceError && error.code === 'not_found')
})
