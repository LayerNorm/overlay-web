import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  WorkspaceAgentAutomation,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentThread,
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

function mockWorkspaces(
  principalId: string,
  role: WorkspaceMembershipRole,
  principals: Record<string, { type: 'human' | 'agent'; agentId?: string }> = {},
) {
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
    async resolvePrincipal(id: string) {
      const found = principals[id]
      if (!found) return null
      return { id, workspaceId: WORKSPACE_ID, type: found.type, agentId: found.agentId, displayName: id }
    },
  } as unknown as WorkspaceService
}

function serviceFor(
  principalId: string,
  role: WorkspaceMembershipRole,
  seed: WorkspaceAgentDirectoryItem[] = [],
  principals: Record<string, { type: 'human' | 'agent'; agentId?: string }> = {},
  options: {
    threads?: Array<WorkspaceAgentThread & { agentId: string }>
    automations?: Array<WorkspaceAgentAutomation & { agentId: string }>
    deleteThreadError?: string
    resolveThreadError?: string
    archivedThreadAgentIds?: string[]
  } = {},
) {
  const store = new Map(seed.map((agent) => [agent.id, agent]))
  const created: CreateWorkspaceAgentRecord[] = []
  const updated: UpdateWorkspaceAgentRecord[] = []
  const archived: Array<{ agentId: string; workspaceId: string }> = []
  const unarchived: Array<{ agentId: string; workspaceId: string }> = []
  const threadStore = [...(options.threads ?? [])]
  const automationStore = [...(options.automations ?? [])]
  const deletedThreads: string[] = []
  const archivedThreads: Array<{ conversationId: string; archived: boolean }> = []
  let idCounter = 0
  const service = new WorkspaceAgentService(
    {
      async list({ includeArchived }: { includeArchived?: boolean } = {}) {
        return [...store.values()].filter((agent) => includeArchived || !agent.archivedAt)
      },
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
          avatarShape: input.avatarShape,
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
        const agent = store.get(agentId)
        if (agent) agent.archivedAt = NOW
        return true
      },
      async unarchive({ agentId, workspaceId }: { agentId: string; workspaceId: string }) {
        unarchived.push({ agentId, workspaceId })
        const agent = store.get(agentId)
        if (agent) delete agent.archivedAt
        return true
      },
      async resolveMainThread({ agentId }: { agentId: string; userId: string }) {
        if (options.resolveThreadError) throw new Error(options.resolveThreadError)
        const mine = threadStore
          .filter((thread) => thread.agentId === agentId)
          .sort((a, b) => a.createdAt - b.createdAt)
        const main = mine[0]
        return main
          ? { conversationId: main.conversationId, title: main.title }
          : { conversationId: `conv-${agentId}-main`, title: 'Main' }
      },
      async createThread({ agentId, title }: { agentId: string; userId: string; title?: string }) {
        const thread: WorkspaceAgentThread & { agentId: string } = {
          conversationId: `conv-${++idCounter}`,
          agentId,
          title: title ?? 'New thread',
          lastModified: NOW,
          createdAt: NOW,
          isMain: threadStore.every((thread) => thread.agentId !== agentId),
        }
        threadStore.push(thread)
        return { conversationId: thread.conversationId, title: thread.title }
      },
      async listThreads({ agentId }: { agentId: string; userId: string }) {
        return threadStore.filter((thread) => thread.agentId === agentId)
      },
      async listAgentAutomations({ agentId }: { agentId: string; userId: string }) {
        return automationStore.filter((automation) => automation.agentId === agentId)
      },
      async listArchivedAgentIds() {
        return [...options.archivedThreadAgentIds ?? []]
      },
      async setThreadArchived({ conversationId, archived }: { conversationId: string; archived: boolean }) {
        archivedThreads.push({ conversationId, archived })
      },
      async deleteThread({ conversationId }: { conversationId: string }) {
        if (options.deleteThreadError) throw new Error(options.deleteThreadError)
        deletedThreads.push(conversationId)
      },
    } as unknown as WorkspaceAgentRepository,
    mockWorkspaces(principalId, role, principals),
    () => `generated-${++idCounter}`,
    () => NOW,
  )
  return { service, created, updated, archived, unarchived, deletedThreads, archivedThreads }
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

test('create passes a valid creature shape through and rejects unknown shapes', async () => {
  const { service, created } = serviceFor(CREATOR_PRINCIPAL_ID, 'member', [defaultAgentFixture()])
  const shaped = await service.create({
    actorUserId: 'user-creator',
    workspaceId: WORKSPACE_ID,
    input: { name: 'Shaped', instructions: 'Help everyone.', modelId: 'test-model', avatarShape: 'droplet' },
  })
  assert.equal(shaped.avatarShape, 'droplet')
  assert.equal(created[0]?.avatarShape, 'droplet')
  const error = await serviceError(service.create({
    actorUserId: 'user-creator',
    workspaceId: WORKSPACE_ID,
    input: { name: 'Bogus', instructions: 'Help everyone.', modelId: 'test-model', avatarShape: 'dragon' as never },
  }))
  assert.equal(error.code, 'validation')
})

test('update passes a creature shape through to the repository', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-shared', visibility: 'workspace' })]
  const { service, updated } = serviceFor(CREATOR_PRINCIPAL_ID, 'member', seed)
  const agent = await service.update({
    actorUserId: 'user-creator',
    workspaceId: WORKSPACE_ID,
    agentId: 'agent-shared',
    input: { avatarShape: 'cloud' },
  })
  assert.equal(agent.avatarShape, 'cloud')
  assert.equal(updated[0]?.avatarShape, 'cloud')
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

const DM_PRIVATE_AGENT_PRINCIPAL_ID = 'agent-principal-private'
const DM_SHARED_AGENT_PRINCIPAL_ID = 'agent-principal-shared'

function dmSeed(): WorkspaceAgentDirectoryItem[] {
  return [
    defaultAgentFixture(),
    agentFixture({ id: 'agent-private', principalId: DM_PRIVATE_AGENT_PRINCIPAL_ID, visibility: 'creator' }),
    agentFixture({ id: 'agent-shared', principalId: DM_SHARED_AGENT_PRINCIPAL_ID, visibility: 'workspace' }),
  ]
}

function dmPrincipals(): Record<string, { type: 'human' | 'agent'; agentId?: string }> {
  return {
    [DM_PRIVATE_AGENT_PRINCIPAL_ID]: { type: 'agent', agentId: 'agent-private' },
    [DM_SHARED_AGENT_PRINCIPAL_ID]: { type: 'agent', agentId: 'agent-shared' },
    'principal-human': { type: 'human' },
  }
}

test('DM targets reject a creator-only agent for anyone but its creator', async () => {
  const { service } = serviceFor(OTHER_PRINCIPAL_ID, 'member', dmSeed(), dmPrincipals())
  const error = await serviceError(service.assertDirectMessageTargets({
    actorUserId: 'user-other',
    workspaceId: WORKSPACE_ID,
    principalIds: [DM_PRIVATE_AGENT_PRINCIPAL_ID],
  }))
  assert.equal(error.code, 'not_found')
})

test('DM targets let the creator reach their own creator-only agent', async () => {
  const { service } = serviceFor(CREATOR_PRINCIPAL_ID, 'member', dmSeed(), dmPrincipals())
  await service.assertDirectMessageTargets({
    actorUserId: 'user-creator',
    workspaceId: WORKSPACE_ID,
    principalIds: [DM_PRIVATE_AGENT_PRINCIPAL_ID, DM_SHARED_AGENT_PRINCIPAL_ID],
  })
})

test('DM targets leave humans, unknown principals, and workspace agents alone', async () => {
  const { service } = serviceFor(OTHER_PRINCIPAL_ID, 'member', dmSeed(), dmPrincipals())
  await service.assertDirectMessageTargets({
    actorUserId: 'user-other',
    workspaceId: WORKSPACE_ID,
    principalIds: [DM_SHARED_AGENT_PRINCIPAL_ID, 'principal-human', 'principal-unknown'],
  })
})

test('list excludes archived agents unless includeArchived is set', async () => {
  const seed = [
    defaultAgentFixture(),
    agentFixture({ id: 'agent-live' }),
    agentFixture({ id: 'agent-archived', archivedAt: NOW }),
  ]
  const { service } = serviceFor(CREATOR_PRINCIPAL_ID, 'member', seed, {}, {
    archivedThreadAgentIds: ['agent-live'],
  })
  const live = await service.list({ actorUserId: 'user-creator', workspaceId: WORKSPACE_ID })
  assert.deepEqual(live.agents.map((agent) => agent.id).sort(), ['agent-default', 'agent-live'])
  const all = await service.list({
    actorUserId: 'user-creator',
    workspaceId: WORKSPACE_ID,
    includeArchived: true,
  })
  assert.deepEqual(
    all.agents.map((agent) => agent.id).sort(),
    ['agent-archived', 'agent-default', 'agent-live'],
  )
  assert.deepEqual(all.archivedThreadAgentIds, ['agent-live'])
  assert.deepEqual(live.archivedThreadAgentIds, [])
})

test('unarchive restores an archived agent for its creator', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-archived', archivedAt: NOW })]
  const { service, unarchived } = serviceFor(CREATOR_PRINCIPAL_ID, 'member', seed)
  await service.unarchive({ actorUserId: 'user-creator', workspaceId: WORKSPACE_ID, agentId: 'agent-archived' })
  assert.deepEqual(unarchived, [{ agentId: 'agent-archived', workspaceId: WORKSPACE_ID }])
})

test('unarchive refuses a live agent and an invisible archived agent', async () => {
  const seed = [
    defaultAgentFixture(),
    agentFixture({ id: 'agent-live' }),
    agentFixture({ id: 'agent-archived', archivedAt: NOW, visibility: 'creator' }),
  ]
  const { service } = serviceFor(OTHER_PRINCIPAL_ID, 'member', seed)
  const liveError = await serviceError(service.unarchive({
    actorUserId: 'user-other', workspaceId: WORKSPACE_ID, agentId: 'agent-live',
  }))
  assert.equal(liveError.code, 'not_found')
  const hiddenError = await serviceError(service.unarchive({
    actorUserId: 'user-other', workspaceId: WORKSPACE_ID, agentId: 'agent-archived',
  }))
  assert.equal(hiddenError.code, 'not_found')
})

test('listBundle returns the caller-facing threads and automations for a visible agent', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-shared' })]
  const { service } = serviceFor(OTHER_PRINCIPAL_ID, 'member', seed, {}, {
    threads: [
      { agentId: 'agent-shared', conversationId: 'conv-1', title: 'Main', lastModified: NOW, createdAt: NOW, isMain: true },
    ],
    automations: [
      { agentId: 'agent-shared', automationId: 'auto-1', name: 'Digest', enabled: true },
      { agentId: 'agent-private', automationId: 'auto-2', name: 'Other', enabled: true },
    ],
  })
  const bundle = await service.listBundle({
    actorUserId: 'user-other', workspaceId: WORKSPACE_ID, agentId: 'agent-shared',
  })
  assert.equal(bundle.threads.length, 1)
  assert.deepEqual(bundle.automations.map((automation) => automation.automationId), ['auto-1'])
})

test('listBundle still serves an archived agent but createThread refuses it', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-archived', archivedAt: NOW })]
  const { service } = serviceFor(CREATOR_PRINCIPAL_ID, 'member', seed)
  const bundle = await service.listBundle({
    actorUserId: 'user-creator', workspaceId: WORKSPACE_ID, agentId: 'agent-archived',
  })
  assert.deepEqual(bundle, { threads: [], automations: [] })
  const error = await serviceError(service.createThread({
    actorUserId: 'user-creator', workspaceId: WORKSPACE_ID, agentId: 'agent-archived',
  }))
  assert.equal(error.code, 'not_found')
})

test('resolveMainThread serves an archived agent its existing main thread', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-archived', archivedAt: NOW })]
  const { service } = serviceFor(CREATOR_PRINCIPAL_ID, 'member', seed, {}, {
    threads: [
      { agentId: 'agent-archived', conversationId: 'conv-main', title: 'Main', lastModified: NOW, createdAt: NOW, isMain: true },
    ],
  })
  const thread = await service.resolveMainThread({
    actorUserId: 'user-creator', workspaceId: WORKSPACE_ID, agentId: 'agent-archived',
  })
  assert.equal(thread.conversationId, 'conv-main')
})

test('resolveMainThread maps a backend AGENT_ARCHIVED failure to conflict', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-archived', archivedAt: NOW })]
  const { service } = serviceFor(CREATOR_PRINCIPAL_ID, 'member', seed, {}, {
    resolveThreadError: 'AGENT_ARCHIVED',
  })
  const error = await serviceError(service.resolveMainThread({
    actorUserId: 'user-creator', workspaceId: WORKSPACE_ID, agentId: 'agent-archived',
  }))
  assert.equal(error.code, 'conflict')
})

test('deleteThread maps AGENT_LAST_THREAD to conflict and THREAD_NOT_FOUND to not_found', async () => {
  const seed = [defaultAgentFixture(), agentFixture({ id: 'agent-shared' })]
  const last = serviceFor(CREATOR_PRINCIPAL_ID, 'member', seed, {}, { deleteThreadError: 'AGENT_LAST_THREAD' })
  const conflict = await serviceError(last.service.deleteThread({
    actorUserId: 'user-creator', agentId: 'agent-shared', conversationId: 'conv-1',
  }))
  assert.equal(conflict.code, 'conflict')

  const missing = serviceFor(CREATOR_PRINCIPAL_ID, 'member', seed, {}, { deleteThreadError: 'THREAD_NOT_FOUND' })
  const notFound = await serviceError(missing.service.deleteThread({
    actorUserId: 'user-creator', agentId: 'agent-shared', conversationId: 'conv-gone',
  }))
  assert.equal(notFound.code, 'not_found')
})
