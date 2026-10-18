import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const serverSecret = 'conversation-scope-test'

describe('conversation scope', () => {
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
})
