import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkspaceSearchService } from './WorkspaceSearchService'

const WORKSPACE = 'workspace_acme'
const ACTOR = 'user_actor'
const OWNER = 'user_owner'

function createService(options: {
  accessible?: Array<{
    resourceId: string
    ownerUserId: string
    accessRole: 'viewer' | 'operator' | 'editor'
    targetType: 'principal' | 'team' | 'room'
    resourceType?: string
  }>
  chatResults?: Array<{ conversationId: string; title: string; snippet?: string; conversationType: 'dm' | 'channel' | 'personal' }>
} = {}) {
  const sharingCalls: Array<{ action: string; resourceType: string }> = []
  const service = new WorkspaceSearchService({
    agents: {
      async list() {
        return [
          { id: 'agent_scout', name: 'Scout', description: 'Finds primary evidence', updatedAt: 5 },
          { id: 'agent_writer', name: 'Draft writer', description: 'Writes summaries', updatedAt: 6 },
        ]
      },
    } as never,
    collaboration: {
      async searchWorkspaceChats() {
        return options.chatResults ?? [{
          conversationId: 'conversation_1',
          title: 'launch plan',
          snippet: 'the launch plan is ready',
          conversationType: 'channel' as const,
          authorDisplayName: 'Maya',
          createdAt: 10,
        }]
      },
    } as never,
    conversations: {} as never,
    sharing: {
      async listAccessibleResources(args: { action: string; resourceType: string }) {
        sharingCalls.push({ action: args.action, resourceType: args.resourceType })
        return (options.accessible ?? []).filter((entry) => (
          !entry.resourceType || entry.resourceType === args.resourceType
        ))
      },
    } as never,
    workspaces: {
      async resolveActiveWorkspace(actorUserId: string) {
        if (actorUserId !== ACTOR) throw new Error('FORBIDDEN')
        return { workspace: { id: WORKSPACE }, principal: { id: 'principal_actor' }, membership: { role: 'member' } }
      },
    } as never,
    sources: {
      files: async () => [
        { _id: 'file_own', name: 'Launch checklist', updatedAt: 3 },
        { _id: 'file_other', name: 'Unrelated notes', updatedAt: 2 },
      ],
      projects: async () => [{ id: 'project_own', name: 'Launch project', updatedAt: 4 }],
      knowledgeBases: async () => [{ id: 'kb_own', title: 'Launch research', updatedAt: 1 }],
      automations: async () => [{ id: 'automation_own', name: 'Launch digest', updatedAt: 7 }],
    },
    loaders: {
      file: async ({ resourceId }) => (
        resourceId === 'file_shared' ? { title: 'Shared launch brief', updatedAt: 8 } : null
      ),
      project: async ({ resourceId }) => (
        resourceId === 'project_shared' ? { title: 'Shared launch program', updatedAt: 9 } : null
      ),
      knowledge_base: async () => null,
      automation: async () => null,
    },
  })
  return { service, sharingCalls }
}

test('a query shorter than two characters searches nothing', async () => {
  const { service, sharingCalls } = createService()
  const response = await service.search({
    actorUserId: ACTOR,
    workspaceId: WORKSPACE,
    query: 'l',
    kinds: ['file'],
  })
  assert.deepEqual(response.results, [])
  assert.deepEqual(sharingCalls, [])
})

test('search spans every requested kind and matches on title', async () => {
  const { service } = createService()
  const response = await service.search({
    actorUserId: ACTOR,
    workspaceId: WORKSPACE,
    query: 'launch',
    kinds: ['conversation', 'file', 'project', 'knowledge_base', 'automation', 'agent'],
  })
  const kinds = new Set(response.results.map((result) => result.kind))
  assert.deepEqual([...kinds].sort(), ['automation', 'conversation', 'file', 'knowledge_base', 'project'])
  assert.equal(response.results.some((result) => result.title === 'Unrelated notes'), false)
})

test('shared resources are searched with view authorization, never by title first', async () => {
  const { service, sharingCalls } = createService({
    accessible: [{
      resourceId: 'file_shared',
      ownerUserId: OWNER,
      accessRole: 'viewer',
      targetType: 'team',
      resourceType: 'file',
    }],
  })
  const response = await service.search({
    actorUserId: ACTOR,
    workspaceId: WORKSPACE,
    query: 'launch',
    kinds: ['file'],
  })
  assert.deepEqual(sharingCalls, [{ action: 'view', resourceType: 'file' }])
  const shared = response.results.find((result) => result.id === 'file_shared')
  assert.equal(shared?.title, 'Shared launch brief')
  assert.equal(shared?.sharedVia, 'team')
  assert.equal(shared?.accessRole, 'viewer')
})

test('a grant whose resource no longer loads is dropped instead of leaking an id', async () => {
  const { service } = createService({
    accessible: [{
      resourceId: 'file_deleted',
      ownerUserId: OWNER,
      accessRole: 'viewer',
      targetType: 'principal',
      resourceType: 'file',
    }],
  })
  const response = await service.search({
    actorUserId: ACTOR,
    workspaceId: WORKSPACE,
    query: 'launch',
    kinds: ['file'],
  })
  assert.equal(response.results.some((result) => result.id === 'file_deleted'), false)
})

test('conversation snippets come from the participation-filtered repository', async () => {
  const { service } = createService({
    chatResults: [{
      conversationId: 'conversation_private',
      title: 'leadership',
      snippet: 'quarter numbers',
      conversationType: 'channel',
    }],
  })
  const response = await service.search({
    actorUserId: ACTOR,
    workspaceId: WORKSPACE,
    query: 'leadership',
    kinds: ['conversation'],
  })
  assert.equal(response.results[0]?.title, '#leadership')
  assert.equal(response.results[0]?.snippet, 'quarter numbers')
})

test('exact and prefix title matches rank above mid-string matches', async () => {
  const { service } = createService()
  const response = await service.search({
    actorUserId: ACTOR,
    workspaceId: WORKSPACE,
    query: 'launch',
    kinds: ['file'],
    limitPerKind: 5,
  })
  assert.equal(response.results[0]?.title, 'Launch checklist')
})

test('results per kind are capped by the requested limit', async () => {
  const { service } = createService({
    accessible: [
      { resourceId: 'file_shared', ownerUserId: OWNER, accessRole: 'viewer', targetType: 'room', resourceType: 'file' },
    ],
  })
  const response = await service.search({
    actorUserId: ACTOR,
    workspaceId: WORKSPACE,
    query: 'launch',
    kinds: ['file'],
    limitPerKind: 1,
  })
  assert.equal(response.results.length, 1)
})

test('shared with me lists only grants, never owned resources', async () => {
  const { service } = createService({
    accessible: [
      { resourceId: 'file_shared', ownerUserId: OWNER, accessRole: 'editor', targetType: 'principal', resourceType: 'file' },
      { resourceId: 'project_shared', ownerUserId: OWNER, accessRole: 'viewer', targetType: 'room', resourceType: 'project' },
    ],
  })
  const results = await service.listSharedWithMe({
    actorUserId: ACTOR,
    workspaceId: WORKSPACE,
    kinds: ['file', 'project', 'knowledge_base', 'automation'],
  })
  assert.deepEqual(results.map((result) => result.id), ['project_shared', 'file_shared'])
  assert.equal(results.some((result) => result.id.endsWith('_own')), false)
  assert.equal(results.find((result) => result.id === 'project_shared')?.sharedVia, 'room')
})

test('a non-member cannot search the workspace at all', async () => {
  const { service } = createService()
  await assert.rejects(() => service.search({
    actorUserId: 'user_outsider',
    workspaceId: WORKSPACE,
    query: 'launch',
    kinds: ['file'],
  }))
  await assert.rejects(() => service.listSharedWithMe({
    actorUserId: 'user_outsider',
    workspaceId: WORKSPACE,
    kinds: ['file'],
  }))
})

test('creator-only agents are hidden from search for other members', async () => {
  const agents = [
    {
      id: 'agent_private',
      name: 'Secret scout',
      description: 'Finds secret evidence',
      visibility: 'creator',
      createdByPrincipalId: 'principal_someone_else',
      updatedAt: 7,
    },
    {
      id: 'agent_shared',
      name: 'Shared scout',
      description: 'Finds shared evidence',
      visibility: 'workspace',
      createdByPrincipalId: 'principal_someone_else',
      updatedAt: 8,
    },
  ]
  const service = new WorkspaceSearchService({
    agents: { async list() { return agents } },
    collaboration: { async searchWorkspaceChats() { return [] } },
    conversations: {},
    sharing: { async listAccessibleResources() { return [] } },
    workspaces: {
      async resolveActiveWorkspace() {
        return {
          workspace: { id: WORKSPACE },
          principal: { id: 'principal_actor' },
          membership: { role: 'member' },
        }
      },
    },
    sources: { files: async () => [], projects: async () => [], knowledgeBases: async () => [], automations: async () => [] },
    loaders: { file: async () => null, project: async () => null, knowledge_base: async () => null, automation: async () => null },
  } as never)
  const response = await service.search({
    actorUserId: ACTOR,
    workspaceId: WORKSPACE,
    query: 'scout',
    kinds: ['agent'],
  })
  assert.deepEqual(response.results.map((result) => result.id), ['agent_shared'])
})
