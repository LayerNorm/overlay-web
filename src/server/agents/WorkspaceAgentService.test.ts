import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  WorkspaceAgentDirectoryItem,
  WorkspaceMembershipRole,
} from '@overlay/workspace-contracts'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type {
  CreateWorkspaceAgentRecord,
  UpdateWorkspaceAgentRecord,
  WorkspaceAgentRepository,
} from './WorkspaceAgentRepository'
import {
  WorkspaceAgentService,
  WorkspaceAgentServiceError,
} from './WorkspaceAgentService'

const NOW = 1_800_000_000_000
const WORKSPACE_ID = 'workspace-1'
const CREATOR_PRINCIPAL_ID = 'principal-creator'
const OTHER_PRINCIPAL_ID = 'principal-other'

function agentFixture(overrides: Partial<WorkspaceAgentDirectoryItem> = {}): WorkspaceAgentDirectoryItem {
  return {
    id: 'agent-1',
    workspaceId: WORKSPACE_ID,
    principalId: 'agent-principal-1',
    name: 'Scout',
    description: 'Finds evidence',
    instructions: 'Find primary evidence and cite it.',
    harness: 'overlay',
    modelId: 'test-model',
    avatarColor: '#2563eb',
    allowedToolIds: [],
    invocationPolicy: 'mention',
    visibility: 'workspace',
    createdByPrincipalId: CREATOR_PRINCIPAL_ID,
    createdAt: NOW,
    updatedAt: NOW,
    teamIds: [],
    roomCount: 0,
    ...overrides,
  }
}

function defaultAgentFixture(): WorkspaceAgentDirectoryItem {
  return agentFixture({
    id: 'agent-default',
    principalId: 'agent-principal-default',
    name: 'Overlay',
    isDefault: true,
    visibility: 'workspace',
  })
}

function mockWorkspaces(principalId: string, role: WorkspaceMembershipRole) {
  const access = {
    workspace: { id: WORKSPACE_ID },
    principal: { id: principalId },
    membership: { role },
  }
  return {
    async resolveActiveWorkspace() { return access },
    async listTeams() { return [] },
    async assertMemberMayCreate() { /* allowed */ },
    async assertAgentHarnessAllowed() { /* allowed */ },
  } as unknown as WorkspaceService
}

function serviceFor(principalId: string, role: WorkspaceMembershipRole, seed: WorkspaceAgentDirectoryItem[] = []) {
  const store = new Map(seed.map((agent) => [agent.id, agent]))
  const created: CreateWorkspaceAgentRecord[] = []
  const updated: UpdateWorkspaceAgentRecord[] = []
  const archived: Array<{ agentId: string; workspaceId: string }> = []
  let idCounter = 0
  const service = new WorkspaceAgentService(
    {
      async list() { return [...store.values()] },
      async get({ agentId }: { agentId: string }) { return store.get(agentId) ?? null },
      async create(input: CreateWorkspaceAgentRecord) {
        created.push(input)
        const agent = agentFixture({
          id: input.agentId,
          principalId: input.principalId,
          name: input.name,
          description: input.description,
          instructions: input.instructions,
          harness: input.harness,
          modelId: input.modelId,
          avatarColor: input.avatarColor,
          allowedToolIds: input.allowedToolIds,
          visibility: input.visibility,
          teamIds: input.teamIds,
          createdByPrincipalId: input.createdByPrincipalId,
        })
        store.set(agent.id, agent)
        return agent
      },
      async update(input: UpdateWorkspaceAgentRecord) {
        updated.push(input)
        const current = store.get(input.agentId)
        if (!current) return null
        const next = { ...current, ...input, id: current.id, updatedAt: NOW }
        store.set(next.id, next)
        return next
      },
      async archive({ agentId, workspaceId }: { agentId: string; workspaceId: string }) {
        archived.push({ agentId, workspaceId })
        return true
      },
    } as unknown as WorkspaceAgentRepository,
    mockWorkspaces(principalId, role),
    () => `generated-${++idCounter}`,
    () => NOW,
  )
  return { service, created, updated, archived }
}

async function serviceError(promise: Promise<unknown>): Promise<WorkspaceAgentServiceError> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof WorkspaceAgentServiceError)
    return error
  }
  assert.fail('Expected a WorkspaceAgentServiceError')
}

test('list hides creator-only agents from other members but shows them to the creator', async () => {
  const privateAgent = agentFixture({ id: 'agent-private', visibility: 'creator' })
  const sharedAgent = agentFixture({ id: 'agent-shared', visibility: 'workspace' })
  const seed = [defaultAgentFixture(), privateAgent, sharedAgent]

  const other = serviceFor(OTHER_PRINCIPAL_ID, 'member', seed)
  const otherIds = (await other.service.list({ actorUserId: 'user-other', workspaceId: WORKSPACE_ID })).agents.map((agent) => agent.id)
  assert.deepEqual(otherIds.sort(), ['agent-default', 'agent-shared'])

  const creator = serviceFor(CREATOR_PRINCIPAL_ID, 'member', seed)
  const creatorIds = (await creator.service.list({ actorUserId: 'user-creator', workspaceId: WORKSPACE_ID })).agents.map((agent) => agent.id)
  assert.deepEqual(creatorIds.sort(), ['agent-default', 'agent-private', 'agent-shared'])
})

test('list hides creator-only agents from workspace admins', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-private', visibility: 'creator' })]
  const { service } = serviceFor(OTHER_PRINCIPAL_ID, 'admin', seed)
  const ids = (await service.list({ actorUserId: 'user-admin', workspaceId: WORKSPACE_ID })).agents.map((agent) => agent.id)
  assert.deepEqual(ids, ['agent-default'])
})

test('get reports an invisible agent as not found', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-private', visibility: 'creator' })]
  const { service } = serviceFor(OTHER_PRINCIPAL_ID, 'member', seed)
  const error = await serviceError(service.get({ actorUserId: 'user-other', workspaceId: WORKSPACE_ID, agentId: 'agent-private' }))
  assert.equal(error.code, 'not_found')
})

test('get returns a creator-only agent to its creator', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-private', visibility: 'creator' })]
  const { service } = serviceFor(CREATOR_PRINCIPAL_ID, 'member', seed)
  const agent = await service.get({ actorUserId: 'user-creator', workspaceId: WORKSPACE_ID, agentId: 'agent-private' })
  assert.equal(agent.id, 'agent-private')
})

test('a manager cannot probe a creator-only agent through update', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-private', visibility: 'creator' })]
  const { service } = serviceFor(OTHER_PRINCIPAL_ID, 'admin', seed)
  // `not_found`, not `forbidden`: the manager cannot see this agent, so the
  // edit path must not confirm it exists. Manager access to creator-only
  // agents is archive-only (see below).
  const error = await serviceError(service.update({
    actorUserId: 'user-admin',
    workspaceId: WORKSPACE_ID,
    agentId: 'agent-private',
    input: { name: 'Renamed' },
  }))
  assert.equal(error.code, 'not_found')
})

test('a manager keeps archive access to a creator-only agent as a safety valve', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-private', visibility: 'creator' })]
  const { service, archived } = serviceFor(OTHER_PRINCIPAL_ID, 'admin', seed)
  await service.archive({ actorUserId: 'user-admin', workspaceId: WORKSPACE_ID, agentId: 'agent-private' })
  assert.deepEqual(archived, [{ agentId: 'agent-private', workspaceId: WORKSPACE_ID }])
})

test('a non-manager cannot archive a creator-only agent they cannot see', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-private', visibility: 'creator' })]
  const { service } = serviceFor(OTHER_PRINCIPAL_ID, 'member', seed)
  const error = await serviceError(service.archive({ actorUserId: 'user-other', workspaceId: WORKSPACE_ID, agentId: 'agent-private' }))
  assert.equal(error.code, 'not_found')
})

test('create defaults to workspace visibility and passes creator visibility through', async () => {
  const { service, created } = serviceFor(CREATOR_PRINCIPAL_ID, 'member', [defaultAgentFixture()])
  const shared = await service.create({
    actorUserId: 'user-creator',
    workspaceId: WORKSPACE_ID,
    input: { name: 'Shared', instructions: 'Help everyone.', modelId: 'test-model' },
  })
  assert.equal(shared.visibility, 'workspace')
  const privateAgent = await service.create({
    actorUserId: 'user-creator',
    workspaceId: WORKSPACE_ID,
    input: { name: 'Private', instructions: 'Help me.', modelId: 'test-model', visibility: 'creator' },
  })
  assert.equal(privateAgent.visibility, 'creator')
  assert.deepEqual(created.map((input) => input.visibility), ['workspace', 'creator'])
})

test('update passes a visibility flip through to the repository', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-shared', visibility: 'workspace' })]
  const { service, updated } = serviceFor(CREATOR_PRINCIPAL_ID, 'member', seed)
  const agent = await service.update({
    actorUserId: 'user-creator',
    workspaceId: WORKSPACE_ID,
    agentId: 'agent-shared',
    input: { visibility: 'creator' },
  })
  assert.equal(agent.visibility, 'creator')
  assert.equal(updated[0]?.visibility, 'creator')
})

test('the default master agent is workspace-visible', async () => {
  const { service, created } = serviceFor(CREATOR_PRINCIPAL_ID, 'member', [])
  await service.list({ actorUserId: 'user-creator', workspaceId: WORKSPACE_ID })
  const master = created.find((input) => input.isDefault)
  assert.ok(master)
  assert.equal(master.visibility, 'workspace')
})
