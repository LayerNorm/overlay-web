import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { ConvexConversationCollaborationRepository } from '@/server/conversations/ConvexConversationCollaborationRepository'
import schema from '../../../../../../convex/schema'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { POST } from './route'

const modules = import.meta.glob('../../../../../../convex/**/*.ts')
const mocks = vi.hoisted(() => ({
  mutation: vi.fn(), query: vi.fn(), start: vi.fn(), resolve: vi.fn(), publish: vi.fn(),
  activity: vi.fn(), governance: vi.fn(), server: {} as Record<string, unknown>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/server/database/lazy-convex', () => ({ lazyConvex: { mutation: mocks.mutation, query: mocks.query } }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => mocks.server }))
vi.mock('@/server/conversations/native-thread-compatibility-backend', () => ({ requireNativeThreadCompatibilityBackend: async () => {} }))
vi.mock('@/server/harness/native-turn-start', () => ({ startNativeHarnessTurn: mocks.start }))
vi.mock('@/server/billing/WorkspaceExecutionPolicy', () => ({ requireWorkspaceExecution: async () => ({ billingEnabled: false }) }))
vi.mock('@/server/agents/workspace-agent-invocation', () => ({
  resolveWorkspaceAgentInvocations: mocks.resolve, startRemoteWorkspaceAgentTurn: vi.fn(),
  WorkspaceAgentInvocationError: class extends Error {},
}))
vi.mock('@/server/observability/logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('INTERNAL_API_SECRET', 'replay-test') })
afterEach(() => vi.unstubAllEnvs())

async function setup() {
  const t = convexTest(schema, modules)
  const workspaceId = 'replay-workspace'
  const conversationId = await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId, kind: 'organization', name: 'Replay', slug: 'replay', status: 'active', createdAt: 1, updatedAt: 1 })
    const conversationId = await ctx.db.insert('conversations', { workspaceId, userId: 'alice', conversationType: 'dm', title: 'Replay', lastModified: 1, createdAt: 1,
      lastMode: 'act', askModelIds: ['test'], actModelId: 'test' })
    for (const principalId of ['alice', 'bob', 'agent-p']) {
      const type = principalId === 'agent-p' ? 'agent' as const : 'human' as const
      await ctx.db.insert('workspacePrincipals', { workspaceId, principalId, type, userId: type === 'human' ? principalId : undefined,
        agentId: type === 'agent' ? 'agent' : undefined, displayName: principalId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId, principalId, membershipId: principalId, role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 })
      await ctx.db.insert('conversationParticipants', { workspaceId, conversationId, principalId, principalType: type, role: 'member', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1 })
    }
    return conversationId
  })
  mocks.mutation.mockImplementation((name: string, args: Record<string, unknown>) => t.mutation(makeFunctionReference<'mutation'>(name), args))
  mocks.query.mockImplementation((name: string, args: Record<string, unknown>) => t.query(makeFunctionReference<'query'>(name), args))
  const collaboration = new ConvexConversationCollaborationRepository()
  mocks.activity.mockImplementation((args: Parameters<typeof collaboration.recordMessageActivity>[0]) => collaboration.recordMessageActivity(args))
  const lifecycle = new Set<string>()
  mocks.publish.mockImplementation(async ({ idempotencyKey }: { idempotencyKey: string }) => { lifecycle.add(idempotencyKey) })
  const starts = new Set<string>()
  mocks.start.mockImplementation(async ({ runId }: { runId: string }) => {
    starts.add(runId)
    await t.run(ctx => ctx.db.patch(runId as Id<'conversationAgentRuns'>, { status: 'running', workflowRunId: 'workflow-1' }))
  })
  mocks.resolve.mockImplementation(async ({ messageId }: { messageId: string }) => [{ agentId: 'agent', agentName: 'Agent', agentPrincipalId: 'agent-p',
    harness: 'overlay', modelId: 'test', invocationNonce: `agent:${messageId}:agent`, turnId: `agent_${messageId}_agent` }])
  const conversation = { conversationType: 'dm', title: 'Replay', externalPlatform: undefined as string | undefined }
  mocks.server = {
    workspaceGovernanceService: { assertWithinLimits: mocks.governance },
    appData: { repositories: { conversations: { getConversationById: async () => conversation },
      conversationCollaboration: new Proxy(collaboration, { get(target, property, receiver) {
        return property === 'recordMessageActivity' ? mocks.activity : Reflect.get(target, property, receiver)
      } }) } },
    workspaceService: { resolvePrincipal: async (id: string) => ({ userId: id, type: 'human' }) },
    lifecycleEvents: { publish: mocks.publish },
  }
  const context = { auth: { userId: 'alice' }, workspace: { workspace: { id: workspaceId, name: 'Replay' }, principal: { id: 'alice', displayName: 'Alice' } } } as AppApiRouteContext
  const body = { conversationId, clientNonce: 'nonce', turnId: 'turn', role: 'user', content: '@bob help', mentionedPrincipalIds: ['bob'], memoryEnabled: false }
  const send = (overrides: Record<string, unknown> = {}) => POST(new NextRequest('https://example.test/api/v1/conversations/message', {
    method: 'POST', body: JSON.stringify({ ...body, ...overrides }), headers: { 'content-type': 'application/json' },
  }), context)
  const rows = () => t.run(async ctx => ({ messages: await ctx.db.query('conversationMessages').collect(), activity: await ctx.db.query('workspaceNotifications').collect(), runs: await ctx.db.query('conversationAgentRuns').collect() }))
  return { t, send, rows, lifecycle, starts, conversation }
}

test('route and real repository replay: one canonical message, fanout, lifecycle effect and durable turn start', async () => {
  const f = await setup()
  const first = await f.send()
  expect(first.status).toBe(200)
  const admitted = await first.json()
  const second = await f.send({ turnId: 'changed', content: 'changed', mentionedPrincipalIds: ['eve'] })
  expect(second.status).toBe(200)
  expect(await second.json()).toMatchObject({ messageId: admitted.messageId, turnId: 'turn', replayed: true })
  const rows = await f.rows()
  expect(rows.messages.filter(row => row.authorKind === 'human')).toHaveLength(1)
  expect(rows.activity.filter(row => row.recipientPrincipalId === 'bob')).toHaveLength(1)
  expect(rows.runs).toHaveLength(1)
  expect(f.lifecycle).toEqual(new Set([`workspace.mention:${admitted.messageId}:bob`]))
  expect(f.starts.size).toBe(1)
  expect(mocks.start).toHaveBeenCalledTimes(1)
  expect(mocks.governance).toHaveBeenCalledTimes(2)
})

test('replay retries activity, lifecycle and queued turn dispatch after the first attempt failed', async () => {
  const f = await setup()
  mocks.activity.mockRejectedValueOnce(new Error('activity unavailable'))
  mocks.publish.mockRejectedValueOnce(new Error('lifecycle unavailable'))
  mocks.start.mockRejectedValueOnce(new Error('workflow unavailable'))
  expect((await f.send()).status).toBe(200)
  expect(f.lifecycle.size).toBe(0)
  expect(f.starts.size).toBe(0)
  expect((await f.send()).status).toBe(200)
  const rows = await f.rows()
  expect(rows.messages.filter(row => row.authorKind === 'human')).toHaveLength(1)
  expect(rows.messages.find(row => row.authorKind === 'agent')?.status).toBe('generating')
  expect(rows.activity.filter(row => row.recipientPrincipalId === 'bob')).toHaveLength(1)
  expect(rows.runs).toHaveLength(1)
  expect(f.lifecycle.size).toBe(1)
  expect(f.starts.size).toBe(1)
})

test('empty requests, governance errors and read-only surfaces never admit a message', async () => {
  const f = await setup()
  expect((await f.send({ content: '' })).status).toBe(400)
  mocks.governance.mockRejectedValueOnce(new Error('limit'))
  expect((await f.send()).status).toBe(500)
  f.conversation.externalPlatform = 'slack'
  expect((await f.send()).status).toBe(403)
  expect((await f.rows()).messages).toHaveLength(0)
})
