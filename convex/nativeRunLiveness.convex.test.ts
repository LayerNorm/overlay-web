import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const runLiveness = makeFunctionReference<'query'>('collaboration/rooms:runLiveness')

test('a remote run heartbeat is readable live by room members only, and only for its own room', async () => {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    const room = (title: string) => ctx.db.insert('conversations', {
      workspaceId: 'ws', userId: 'alice', title, conversationType: 'channel', channelVisibility: 'private', scope: 'workspace',
      createdAt: 1, updatedAt: 1, lastModified: 1, lastMode: 'act', askModelIds: [], actModelId: 'm',
    } as never)
    const secret = await room('secret')
    const other = await room('other')
    // Only Alice belongs to the private room.
    await ctx.db.insert('conversationParticipants', {
      conversationId: secret, workspaceId: 'ws', principalId: 'p-alice', principalType: 'human', role: 'member', status: 'active',
      notificationLevel: 'all', joinedAt: 1, updatedAt: 1,
    })
    const message = (role: 'user' | 'assistant') => ctx.db.insert('conversationMessages', {
      conversationId: secret, userId: 'alice', turnId: 't1', role, mode: 'act', content: '', contentType: 'text', createdAt: 1,
    } as never)
    const run = await ctx.db.insert('conversationAgentRuns', {
      conversationId: secret, turnId: 't1', userId: 'alice', userMessageId: await message('user'), assistantMessageId: await message('assistant'),
      mode: 'room', runner: 'remote', status: 'running', externalRunId: 'remote-1', createdAt: 1, updatedAt: 1,
      liveness: { lastActivityAt: 10, lastHeartbeatAt: 10, quietMs: 0, openTools: [{ actionId: 'a', title: 'npm test', runningMs: 500 }], stalled: false },
    } as never)
    return { secret, other, run }
  })
  const as = (subject: string) => t.withIdentity({ subject })
  expect(await as('alice').query(runLiveness, { workspaceId: 'ws', conversationId: ids.secret, runId: 'remote-1' }))
    .toMatchObject({ openTools: [{ title: 'npm test' }], stalled: false })
  // A new heartbeat shows on the next read.
  await t.run(async ctx => {
    await ctx.db.patch(ids.run, { liveness: { lastActivityAt: 20, lastHeartbeatAt: 20, quietMs: 0, openTools: [], stalled: false } })
  })
  expect(await as('alice').query(runLiveness, { workspaceId: 'ws', conversationId: ids.secret, runId: 'remote-1' })).toMatchObject({ lastHeartbeatAt: 20, openTools: [] })
  // Not a member of the private room, the wrong room for the run, or a stranger: nothing.
  expect(await as('bob').query(runLiveness, { workspaceId: 'ws', conversationId: ids.secret, runId: 'remote-1' })).toBeNull()
  expect(await as('alice').query(runLiveness, { workspaceId: 'ws', conversationId: ids.other, runId: 'remote-1' })).toBeNull()
  expect(await as('stranger').query(runLiveness, { workspaceId: 'ws', conversationId: ids.secret, runId: 'remote-1' })).toBeNull()
})
