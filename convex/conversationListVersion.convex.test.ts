import { SignJWT } from 'jose'
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'conversation-list-version-test'

async function setup() {
  process.env.INTERNAL_API_SECRET = secret
  const convex = convexTest(schema, modules)
  const conversationId = await convex.run(async ctx => {
    await ctx.db.insert('workspacePrincipals', { principalId: 'principal', workspaceId: 'workspace',
      userId: 'user', type: 'human', displayName: 'Test', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceMemberships', { membershipId: 'membership', principalId: 'principal', workspaceId: 'workspace',
      role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 })
    return ctx.db.insert('conversations', { userId: 'user', workspaceId: 'workspace',
      title: 'Test', lastModified: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'test' })
  })
  const accessToken = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('user')
    .setIssuer('overlay-browser-convex').setAudience('overlay-convex').setIssuedAt().setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret))
  const read = async () => Promise.all([
    convex.query(api.collaboration.directMessages.watchConversationListVersion,
      { accessToken, actorUserId: 'user', workspaceId: 'workspace' }),
    convex.query(api.chat.conversations.watchPersonalConversationListVersion, { accessToken, userId: 'user' }),
  ])
  const insert = (type: string, workspaceId = 'workspace', userId = 'user', count = 1) => convex.run(async ctx => {
    for (let i = 0; i < count; i++) await ctx.db.insert('conversationEvents', {
      conversationId, workspaceId, userId, type, createdAt: Date.now(),
    })
  })
  return { convex, accessToken, read, insert }
}

describe('conversation sidebar invalidation', () => {
  test('long text streams never advance or regress the list version; semantic events do', async () => {
    const { read, insert } = await setup()
    expect(await read()).toEqual([{ ok: true, version: 0 }, { ok: true, version: 0 }])
    for (const type of ['conversation.created', 'conversation.updated', 'message.created',
      'message.completed', 'message.failed', 'conversation.deleted']) {
      const previous = await read()
      await insert(type)
      const next = await read()
      expect(next[0].version).toBeGreaterThan(previous[0].version)
      expect(next[1].version).toBeGreaterThan(previous[1].version)
      await insert('message.delta', 'workspace', 'user', 500)
      expect(await read()).toEqual(next)
    }
  })

  test('workspace and personal signals remain scoped and preserve authentication', async () => {
    const { convex, accessToken, read, insert } = await setup()
    await insert('message.created', 'foreign-workspace', 'foreign-user')
    expect(await read()).toEqual([{ ok: true, version: 0 }, { ok: true, version: 0 }])
    await insert('message.completed', 'workspace', 'foreign-user')
    const [workspace, personal] = await read()
    expect(workspace.version).toBeGreaterThan(0)
    expect(personal.version).toBe(0)
    await insert('message.completed', 'foreign-workspace', 'user')
    const next = await read()
    expect(next[0]).toEqual(workspace)
    expect(next[1].version).toBeGreaterThan(0)
    expect(await convex.query(api.collaboration.directMessages.watchConversationListVersion,
      { accessToken, actorUserId: 'user', workspaceId: 'foreign-workspace' })).toEqual({ ok: false, version: 0 })
    expect(await convex.query(api.chat.conversations.watchPersonalConversationListVersion,
      { accessToken, userId: 'foreign-user' })).toEqual({ ok: false, version: 0 })
  })
})
