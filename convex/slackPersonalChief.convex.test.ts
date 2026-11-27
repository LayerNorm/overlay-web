import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'slack-personal-chief-secret'
const now = 1_900_000_000_000
const resolveThread = makeFunctionReference<'mutation'>('integrations/slack:resolveThreadByServer')
const personalChief = makeFunctionReference<'query'>('integrations/slack:personalChiefByServer')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: now, updatedAt: now })
    // Gus is suspended, so he can't have a personal chief.
    for (const [userId, displayName, status] of [['ada', 'Ada Lovelace', 'active'], ['gus', 'Gus Away', 'suspended']] as const) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status, joinedAt: now, updatedAt: now })
    }
  })
  return t
}

const origin = (kind: 'channel' | 'dm', threadTs: string) => ({ platform: 'slack', teamId: 'T1', channelId: kind === 'dm' ? 'D1' : 'C1', threadTs, kind })

test('a channel question goes to the workspace Overlay and creates no personal chief', async () => {
  const t = await fixture()
  const thread = await t.mutation(resolveThread, {
    serverSecret: secret, workspaceId: 'ws', userId: 'ada', principalId: 'p-ada', title: 'q', origin: origin('channel', '1.1'),
  } as never) as { agentId: string }
  expect(thread.agentId).toBe('workspace-chief-ws')
  const personal = await t.run(async (ctx) => (await ctx.db.query('workspaceAgentDefinitions').collect())
    .filter((row) => row.agentRole === 'personal_chief'))
  expect(personal).toHaveLength(0)
  expect(await t.query(personalChief, { serverSecret: secret, workspaceId: 'ws', userId: 'ada' } as never)).toEqual({ name: null })
  expect(await t.query(personalChief, { serverSecret: secret, workspaceId: 'ws', userId: 'gus' } as never)).toBeNull()
})

test('asking privately creates the asker’s own personal chief, only in their DM', async () => {
  const t = await fixture()
  await expect(t.mutation(resolveThread, {
    serverSecret: secret, workspaceId: 'ws', userId: 'ada', principalId: 'p-ada', title: 'q',
    origin: origin('channel', '2.1'), agentRole: 'personal_chief',
  } as never)).rejects.toThrow('SLACK_PERSONAL_CHIEF_DM_ONLY')
  const thread = await t.mutation(resolveThread, {
    serverSecret: secret, workspaceId: 'ws', userId: 'ada', principalId: 'p-ada', title: 'q',
    origin: origin('dm', '2.2'), agentRole: 'personal_chief',
  } as never) as { agentId: string }
  expect(thread.agentId).toBe('personal-chief-ws-ada')
  expect(await t.query(personalChief, { serverSecret: secret, workspaceId: 'ws', userId: 'ada' } as never)).toEqual({ name: 'Ada’s Chief' })
})
