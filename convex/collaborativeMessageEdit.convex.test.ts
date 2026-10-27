import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { hydrateRemoteMessage, prepareRemoteMessageText } from './lib/remoteMessageText'

const modules = import.meta.glob('./**/*.ts')
const secret = 'collaborative-message-edit-test-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
const edit = makeFunctionReference<'mutation'>('collaboration/directMessages:editMessage')

for (const chunked of [false, true]) {
  test(`editing ${chunked ? 'chunked' : 'inline'} human text updates rendered parts and preserves attachments`, async () => {
    const t = convexTest(schema, modules)
    const ids = await t.run(async ctx => {
      await ctx.db.insert('workspacePrincipals', { principalId: 'human', workspaceId: 'qa', type: 'human', userId: 'owner', displayName: 'QA', createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { membershipId: 'qa-member', workspaceId: 'qa', principalId: 'human', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 })
      const conversationId = await ctx.db.insert('conversations', { userId: 'owner', workspaceId: 'qa', title: 'QA', conversationType: 'personal', lastModified: 1, updatedAt: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'm' })
      const messageId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'owner', authorKind: 'human', authorPrincipalId: 'human', turnId: 't', role: 'user', mode: 'act', content: 'Original message', parts: [{ type: 'text', text: 'Original ' }, { type: 'file', url: 'https://example.test/file', mediaType: 'text/plain' }, { type: 'text', text: 'message' }], contentType: 'text', status: 'completed', createdAt: 1, updatedAt: 1 })
      if (chunked) {
        const message = (await ctx.db.get(messageId))!
        const patch = await prepareRemoteMessageText(ctx, message, { content: message.content, parts: message.parts! })
        await ctx.db.patch(messageId, { content: patch.content, parts: patch.parts, remoteTextStored: patch.remoteTextStored })
      }
      return { conversationId, messageId }
    })
    expect(await t.mutation(edit, { ...ids, actorUserId: 'owner', workspaceId: 'qa', serverSecret: secret, content: '  Saved message  ' })).toBe(true)
    const message = await t.run(async ctx => hydrateRemoteMessage(ctx, (await ctx.db.get(ids.messageId))!))
    expect(message.content).toBe('Saved message')
    expect(message.parts?.filter(p => p.type === 'text')).toEqual([{ type: 'text', text: 'Saved message' }])
    expect(message.parts?.filter(p => p.type === 'file')).toEqual([{ type: 'file', url: 'https://example.test/file', mediaType: 'text/plain' }])
    expect(message.editHistory?.[0]?.content).toBe('Original message')
    expect(message.editedAt).toBeGreaterThan(1)
    await t.run(async ctx => { await ctx.db.patch(ids.messageId, { authorPrincipalId: 'someone-else' }) })
    expect(await t.mutation(edit, { ...ids, actorUserId: 'owner', workspaceId: 'qa', serverSecret: secret, content: 'Unauthorized edit' })).toBe(false)
    expect((await t.run(async ctx => hydrateRemoteMessage(ctx, (await ctx.db.get(ids.messageId))!))).content).toBe('Saved message')
  })
}
