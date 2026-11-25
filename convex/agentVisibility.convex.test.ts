import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-visibility-test-secret'
const now = 1_900_000_000_000
const workspaceId = 'ws-visibility'
const update = makeFunctionReference<'mutation'>('collaboration/agents:updateByServer')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function fixture() {
  const convex = convexTest(schema, modules)
  const channels = await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', { workspaceId, kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: now, updatedAt: now })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { principalId: `p-${userId}`, workspaceId, type: 'human', userId, displayName: userId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { membershipId: `m-${userId}`, workspaceId, principalId: `p-${userId}`, role: userId === 'bob' ? 'owner' : 'member', status: 'active', joinedAt: now, updatedAt: now })
    }
    for (const [agentId, visibility] of [['private', 'creator'], ['shared', 'workspace']] as const) {
      await ctx.db.insert('workspacePrincipals', { principalId: `ap-${agentId}`, workspaceId, type: 'agent', agentId, displayName: agentId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceAgentDefinitions', {
        agentId, workspaceId, principalId: `ap-${agentId}`, name: agentId, instructions: 'Help.', harness: 'overlay',
        modelId: 'model', allowedToolIds: [], invocationPolicy: 'mention', visibility, createdByPrincipalId: 'p-alice',
        createdAt: now, updatedAt: now,
      } as never)
    }
    const channel = (title: string, channelVisibility: 'public' | 'private') => ctx.db.insert('conversations', {
      userId: 'alice', workspaceId, conversationType: 'channel', channelVisibility, title,
      lastModified: now, createdAt: now, lastMode: 'ask', askModelIds: [], actModelId: 'model',
    } as never)
    return { general: await channel('general', 'public'), secret: await channel('secret', 'private') }
  })
  const visibilityOf = (agentId: string) => convex.run(async (ctx) => (await ctx.db.query('workspaceAgentDefinitions')
    .withIndex('by_agentId', (q) => q.eq('agentId', agentId)).unique())?.visibility)
  const membershipsOf = (principalId: string) => convex.run(async (ctx) => (await ctx.db.query('conversationParticipants')
    .withIndex('by_workspaceId_principalId_status', (q) => q.eq('workspaceId', workspaceId).eq('principalId', principalId)).collect())
    .map((row) => row.conversationId))
  const set = (agentId: string, visibility: 'creator' | 'workspace', updatedByPrincipalId: string) =>
    convex.mutation(update, { serverSecret: secret, agentId, workspaceId, now: now + 1, visibility, updatedByPrincipalId })
  return { convex, channels, visibilityOf, membershipsOf, set }
}

test('a workspace agent never goes back to creator-only, whoever asks', async () => {
  const { set, visibilityOf } = await fixture()
  await expect(set('shared', 'creator', 'p-alice')).rejects.toThrow(/WORKSPACE_AGENT_VISIBILITY_ONE_WAY/)
  await expect(set('shared', 'creator', 'p-bob')).rejects.toThrow(/WORKSPACE_AGENT_VISIBILITY_ONE_WAY/)
  expect(await visibilityOf('shared')).toBe('workspace')
  // Saving the form with the same visibility is not a move.
  await expect(set('shared', 'workspace', 'p-alice')).resolves.toMatchObject({ visibility: 'workspace' })
})

test('only its creator moves a creator-only agent to the workspace, and it joins the public channels', async () => {
  const { set, visibilityOf, membershipsOf, channels } = await fixture()
  await expect(set('private', 'workspace', 'p-bob')).rejects.toThrow(/WORKSPACE_AGENT_EDIT_FORBIDDEN/)
  expect(await visibilityOf('private')).toBe('creator')
  expect(await membershipsOf('ap-private')).toEqual([])

  await expect(set('private', 'workspace', 'p-alice')).resolves.toMatchObject({ visibility: 'workspace' })
  expect(await visibilityOf('private')).toBe('workspace')
  expect(await membershipsOf('ap-private')).toEqual([channels.general])
  await expect(set('private', 'creator', 'p-alice')).rejects.toThrow(/WORKSPACE_AGENT_VISIBILITY_ONE_WAY/)
})
