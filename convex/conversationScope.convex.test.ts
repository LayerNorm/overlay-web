import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const serverSecret = 'conversation-scope-test'

describe('conversation scope', () => {
  test('branch copies persist in the selected workspace and reject another workspace', async () => {
    process.env.INTERNAL_API_SECRET = serverSecret
    const convex = convexTest(schema, modules)
    const auth = { userId: 'user', serverSecret }
    const conversationId = await convex.mutation(api.chat.conversations.create, { ...auth, workspaceId: 'workspace', title: 'Branch' })
    for (const role of ['user', 'assistant'] as const) {
      await convex.mutation(api.chat.conversations.addMessage, {
        ...auth, conversationId, workspaceId: 'workspace', turnId: 'turn-1', role,
        mode: 'act', contentType: 'text', content: `${role} content`,
        parts: [{ type: 'text', text: `${role} content` }], skipMemoryExtraction: true,
      })
    }
    const rows = await convex.run(async (ctx) => await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId)).collect())
    expect(rows.map((row) => row.content)).toEqual(['user content', 'assistant content'])
    await expect(convex.mutation(api.chat.conversations.addMessage, {
      ...auth, conversationId, workspaceId: 'other-workspace', turnId: 'turn-2', role: 'user',
      mode: 'act', contentType: 'text', content: 'Wrong workspace',
    })).rejects.toThrow('Unauthorized')
  })

  test('a workspace automation’s instructions never become its creator’s private memory (P6)', async () => {
    process.env.INTERNAL_API_SECRET = serverSecret
    const convex = convexTest(schema, modules)
    const auth = { userId: 'user', serverSecret, workspaceId: 'workspace' }
    const threadFor = async (scope: 'workspace' | 'personal') => {
      const conversationId = await convex.mutation(api.chat.conversations.create, { ...auth, title: `${scope} automation` })
      await convex.run(async (ctx) => { await ctx.db.insert('automations', {
        userId: 'user', workspaceId: 'workspace', name: scope, instructions: 'x', enabled: true, conversationId, scope,
        createdAt: 1, updatedAt: 1,
      } as never) })
      await convex.mutation(api.chat.conversations.addMessage, {
        ...auth, conversationId, turnId: `turn-${scope}`, role: 'user', mode: 'act', contentType: 'text',
        content: 'Summarise the pipeline', parts: [{ type: 'text', text: 'Summarise the pipeline' }],
      })
      return conversationId
    }
    const workspaceThread = await threadFor('workspace')
    const personalThread = await threadFor('personal')
    const extractions = await convex.run(async (ctx) => (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.name.includes('extractFromTurn'))
      .map((job) => (job.args[0] as { conversationId: string }).conversationId))
    expect(extractions).toEqual([personalThread])
    expect(extractions).not.toContain(workspaceThread)
  })

  test('workspace AI chats keep their scope and existing chats stay personal', async () => {
    process.env.INTERNAL_API_SECRET = serverSecret
    const convex = convexTest(schema, modules)
    const base = { userId: 'user', workspaceId: 'workspace', serverSecret, title: 'Chat' }
    const workspaceId = await convex.mutation(api.chat.conversations.create, { ...base, scope: 'workspace' })
    const personalId = await convex.mutation(api.chat.conversations.create, { ...base, scope: 'personal' })
    const legacyId = await convex.mutation(api.chat.conversations.create, base)

    const listed = await convex.query(api.chat.conversations.list, { userId: 'user', workspaceId: 'workspace', serverSecret })
    const scopeOf = (id: string) => listed.find((row) => row._id === id)?.scope ?? 'personal'
    expect(scopeOf(workspaceId)).toBe('workspace')
    expect(scopeOf(personalId)).toBe('personal')
    expect(scopeOf(legacyId)).toBe('personal')
    expect(listed.find((row) => row._id === personalId)?.scope).toBeUndefined()
  })

  test('personal assistant messages accept and retain storage omission metadata', async () => {
    process.env.INTERNAL_API_SECRET = serverSecret
    const convex = convexTest(schema, modules)
    const auth = { userId: 'user', workspaceId: 'workspace', serverSecret }
    const conversationId = await convex.mutation(api.chat.conversations.create, { ...auth, title: 'Compacted chat' })
    const parts = [
      { type: 'text', text: '[7 additional assistant parts omitted for storage]', storageOmittedParts: 7 },
      { type: 'text', text: 'Final answer' },
    ]
    await convex.mutation(api.chat.conversations.addMessage, {
      ...auth, conversationId, turnId: 'turn', role: 'assistant', mode: 'act',
      contentType: 'text', content: 'Final answer', parts, skipMemoryExtraction: true,
    })
    const rows = await convex.run(ctx => ctx.db.query('conversationMessages')
      .withIndex('by_conversationId', q => q.eq('conversationId', conversationId)).collect())
    expect(rows[0]?.parts).toEqual(parts)
  })
})
