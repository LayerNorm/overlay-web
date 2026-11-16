import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const create = makeFunctionReference<'mutation'>('agents/threads:create')
const deleteTurn = makeFunctionReference<'mutation'>('agents/threads:deleteTurn')
const branch = makeFunctionReference<'mutation'>('agents/threads:branch')

const shared = { workspaceId: 'ws', agentId: 'shared' }

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: 'ap-shared', agentId: 'shared', type: 'agent', displayName: 'Atlas', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceAgentDefinitions', {
      agentId: 'shared', workspaceId: 'ws', principalId: 'ap-shared', name: 'Atlas', instructions: 'Help.', harness: 'overlay',
      modelId: 'model', allowedToolIds: [], invocationPolicy: 'mention', visibility: 'workspace', createdByPrincipalId: 'p-alice', createdAt: 1, updatedAt: 1,
    } as never)
  })
  const as = (subject: string) => t.withIdentity({ subject })
  const thread = await as('alice').mutation(create, { ...shared, title: 'Pricing' }) as { conversationId: Id<'conversations'> }
  const conversationId = thread.conversationId
  const exchange = (at: number, text: string, status: 'completed' | 'generating' = 'completed') => t.run(async ctx => {
    const ask = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'alice', authorKind: 'human', authorPrincipalId: 'p-alice', turnId: `human_${at}`,
      role: 'user', mode: 'act', content: text, contentType: 'text', parts: [{ type: 'text', text }], createdAt: at, updatedAt: at,
    })
    const reply = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'alice', authorKind: 'agent', authorPrincipalId: 'ap-shared', turnId: `agent_${ask}_shared`,
      role: 'assistant', mode: 'act', content: `Re: ${text}`, contentType: 'text', status, createdAt: at + 1, updatedAt: at + 1,
    })
    return { ask, reply }
  })
  return { t, as, conversationId, exchange }
}

test('deleting from an agent reply removes the whole exchange and nothing else', async () => {
  const { t, as, conversationId, exchange } = await fixture()
  const first = await exchange(10, 'Fix the table')
  const second = await exchange(20, 'Also the footer')

  const result = await as('alice').mutation(deleteTurn, { ...shared, conversationId, messageId: first.reply }) as { deletedMessageIds: string[] }

  expect(new Set(result.deletedMessageIds)).toEqual(new Set([first.ask, first.reply]))
  const rows = await t.run(ctx => Promise.all([first.ask, first.reply, second.ask, second.reply].map(id => ctx.db.get(id))))
  expect(rows.map(row => Boolean(row?.deletedAt))).toEqual([true, true, false, false])
  expect(rows[0]?.content).toBe('')
})

test('a reply that is still being written cannot be deleted', async () => {
  const { as, conversationId, exchange } = await fixture()
  const running = await exchange(10, 'Fix the table', 'generating')
  await expect(as('alice').mutation(deleteTurn, { ...shared, conversationId, messageId: running.ask }))
    .rejects.toThrow('TURN_IN_PROGRESS')
})

test('another member cannot change or branch someone else’s agent thread', async () => {
  const { as, conversationId, exchange } = await fixture()
  const first = await exchange(10, 'Fix the table')
  await expect(as('bob').mutation(deleteTurn, { ...shared, conversationId, messageId: first.reply })).rejects.toThrow('THREAD_NOT_FOUND')
  await expect(as('bob').mutation(branch, { ...shared, conversationId, messageId: first.reply })).rejects.toThrow('THREAD_NOT_FOUND')
})

test('branching copies the transcript up to the chosen reply into a new thread with the agent', async () => {
  const { t, as, conversationId, exchange } = await fixture()
  const first = await exchange(10, 'Fix the table')
  await exchange(20, 'Also the footer')

  const created = await as('alice').mutation(branch, { ...shared, conversationId, messageId: first.reply }) as { conversationId: Id<'conversations'>; title: string }

  expect(created.title).toBe('Pricing branch')
  const { conversation, messages, participants } = await t.run(async ctx => ({
    conversation: await ctx.db.get(created.conversationId),
    messages: await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', created.conversationId)).collect(),
    participants: await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', q => q.eq('conversationId', created.conversationId)).collect(),
  }))
  expect(conversation).toMatchObject({ agentId: 'shared', userId: 'alice', conversationType: 'dm' })
  expect(participants.map(row => row.principalId).sort()).toEqual(['ap-shared', 'p-alice'])
  expect(messages.map(row => [row.authorKind, row.content, row.status])).toEqual([
    ['human', 'Fix the table', 'completed'],
    ['agent', 'Re: Fix the table', 'completed'],
  ])
})
