import {convexTest} from 'convex-test'
import {expect, test} from 'vitest'
import {api} from './_generated/api'
import schema from './schema'
const modules = import.meta.glob('./**/*.ts')

test('remote run liveness follows active room membership and preserves personal and cross-room denial', async () => {
  process.env.INTERNAL_API_SECRET = 'remote-run-access-test'
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('workspacePrincipals', {principalId: 'viewer', userId: 'viewer', workspaceId: 'workspace',
      type: 'human', displayName: 'Viewer', createdAt: 1, updatedAt: 1})
    const membership = await ctx.db.insert('workspaceMemberships', {membershipId: 'membership', principalId: 'viewer',
      workspaceId: 'workspace', role: 'member', status: 'active', joinedAt: 1, updatedAt: 1})
    const common = {userId: 'creator', workspaceId: 'workspace', title: 'QA', lastModified: 1,
      createdAt: 1, lastMode: 'act' as const, askModelIds: [], actModelId: 'test'}
    const room = await ctx.db.insert('conversations', {...common, conversationType: 'channel'})
    const personal = await ctx.db.insert('conversations', common)
    const other = await ctx.db.insert('conversations', {...common, conversationType: 'channel'})
    const participant = await ctx.db.insert('conversationParticipants', {conversationId: room, workspaceId: 'workspace',
      principalId: 'viewer', principalType: 'human', notificationLevel: 'all', role: 'member', status: 'active', joinedAt: 1, updatedAt: 1})
    return {room, personal, other, membership, participant}
  })
  const read = (conversationId: typeof ids.room) => t.query(api.chat.conversations.getLatestAgentRun,
    {conversationId, remoteRunId: 'missing-run', userId: 'viewer', serverSecret: 'remote-run-access-test'})
  expect(await read(ids.room)).toBeNull()
  await expect(read(ids.other)).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
  await expect(read(ids.personal)).rejects.toThrow('Unauthorized')
  await t.run(ctx => ctx.db.patch(ids.membership, {status: 'suspended'}))
  await expect(read(ids.room)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})
