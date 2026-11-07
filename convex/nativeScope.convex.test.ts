import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { Doc } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const workspace = makeFunctionReference<'query'>('auth/viewer:workspace')
const personalChat = makeFunctionReference<'query'>('auth/viewer:personalChat')

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const memberships = []
    const principals = []
    const workspaces = []
    for (const workspaceId of ['workspace-a', 'workspace-b']) {
      workspaces.push(await ctx.db.insert('workspaces', {
        workspaceId, kind: 'organization', name: 'QA', slug: workspaceId, status: 'active', createdAt: 1, updatedAt: 1,
      }))
      const principalId = `${workspaceId}:user-a`
      principals.push(await ctx.db.insert('workspacePrincipals', {
        workspaceId, principalId, userId: 'user-a', type: 'human', displayName: 'QA', createdAt: 1, updatedAt: 1,
      }))
      memberships.push(await ctx.db.insert('workspaceMemberships', {
        workspaceId, principalId, membershipId: principalId, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1,
      }))
    }
    const conversationId = await ctx.db.insert('conversations', {
      workspaceId: 'workspace-a', userId: 'user-a', title: 'QA', lastMode: 'act', actModelId: 'test',
      askModelIds: [], createdAt: 1, lastModified: 1,
    })
    return { conversationId, memberships, principals, workspaces }
  })
  const user = t.withIdentity({ subject: 'user-a', issuer: 'https://issuer.example.test' })
  const args = { workspaceId: 'workspace-a', conversationId: ids.conversationId }
  return { t, user, ids, args }
}

test('native viewer is the only actor authority and workspace switching is explicitly scoped', async () => {
  const { t, user, args } = await fixture()
  await expect(t.query(personalChat, args)).rejects.toThrow('UNAUTHENTICATED')
  await expect(t.withIdentity({ subject: 'user-b' }).query(personalChat, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  for (const supplied of [{ userId: 'user-b' }, { actorUserId: 'user-b' }, { serverSecret: 'secret' }, { accessToken: 'token' }]) {
    await expect(user.query(personalChat, { ...args, ...supplied })).rejects.toThrow()
  }
  expect(await user.query(personalChat, args)).toEqual(args)
  expect(await user.query(workspace, { workspaceId: 'workspace-b' })).toMatchObject({ userId: 'user-a', role: 'member' })
  await expect(user.query(personalChat, { ...args, workspaceId: 'workspace-b' })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
  await expect(user.query(workspace, { workspaceId: 'unknown' })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})

test('membership revocation and archived principals/workspaces invalidate subsequent reads', async () => {
  const { t, user, ids, args } = await fixture()
  await user.query(personalChat, args)
  await t.run(ctx => ctx.db.patch(ids.memberships[0]!, { status: 'suspended' }))
  await expect(user.query(personalChat, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await t.run(async ctx => {
    await ctx.db.patch(ids.memberships[0]!, { status: 'active', role: 'guest' })
  })
  expect(await user.query(workspace, { workspaceId: args.workspaceId })).toMatchObject({ role: 'guest' })
  await t.run(ctx => ctx.db.patch(ids.principals[0]!, { archivedAt: 0 }))
  await expect(user.query(personalChat, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await t.run(async ctx => {
    await ctx.db.patch(ids.principals[0]!, { archivedAt: undefined })
    await ctx.db.patch(ids.workspaces[0]!, { status: 'archived' })
  })
  await expect(user.query(personalChat, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})

test('native chat access excludes other owners, shared links, rooms, agent threads and external chats', async () => {
  const { t, user, ids, args } = await fixture()
  const patches: Partial<Doc<'conversations'>>[] = [
    { userId: 'user-b', shareVisibility: 'public' }, { userId: 'user-b', scope: 'workspace' }, { userId: 'user-b', isAutomation: true },
    { conversationType: 'dm' }, { conversationType: 'channel' }, { agentId: 'agent' },
    { externalPlatform: 'slack' }, { surfaceBindingId: 'binding' }, { deletedAt: 0 }, { workspaceId: undefined },
  ]
  for (const patch of patches) {
    await t.run(async ctx => {
      const original = await ctx.db.get(ids.conversationId)
      const { _id: _id, _creationTime: _creationTime, ...fields } = original!
      const id = await ctx.db.insert('conversations', { ...fields, ...patch })
      args.conversationId = id
    })
    await expect(user.query(personalChat, args)).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
  }
})

test('an owner can use their own workspace-filed and automation chats', async () => {
  const { t, user, ids, args } = await fixture()
  for (const patch of [{ scope: 'workspace' }, { isAutomation: true }] as Partial<Doc<'conversations'>>[]) {
    await t.run(async ctx => {
      const original = await ctx.db.get(ids.conversationId)
      const { _id: _id, _creationTime: _creationTime, ...fields } = original!
      args.conversationId = await ctx.db.insert('conversations', { ...fields, ...patch })
    })
    expect(await user.query(personalChat, args)).toEqual(args)
  }
})

test('legacy personal chats need no participant but removed participants cannot use native access', async () => {
  const { t, user, ids, args } = await fixture()
  expect(await user.query(personalChat, args)).toEqual(args)
  const participantId = await t.run(ctx => ctx.db.insert('conversationParticipants', {
    conversationId: ids.conversationId, workspaceId: args.workspaceId, principalId: 'workspace-a:user-a',
    principalType: 'human', role: 'moderator', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1, archivedAt: 2,
  }))
  expect(await user.query(personalChat, args)).toEqual(args)
  await t.run(ctx => ctx.db.patch(participantId, { status: 'removed', removedAt: 3 }))
  await expect(user.query(personalChat, args)).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
})

test('legacy automation bindings stay owner-only and leave chat kind when deleted', async () => {
  const { t, user, args } = await fixture()
  const summary = makeFunctionReference<'query'>('chat/personal:getSummary')
  const role = await t.run(ctx => ctx.db.insert('authorizationRoles', {
    roleId: 'scope-reader', name: 'Reader', capabilities: ['conversations.read'], isSystem: true, createdAt: 1, updatedAt: 1,
  }))
  expect(role).toBeTruthy()
  await t.run(ctx => ctx.db.insert('authorizationUserRoles', { roleId: 'scope-reader', userId: 'user-a', createdAt: 1 }))
  expect(await user.query(summary, args)).toMatchObject({ kind: 'personal' })
  const automationId = await t.run(ctx => ctx.db.insert('automations', {
    workspaceId: args.workspaceId, userId: 'user-a', conversationId: args.conversationId,
    createdAt: 1, updatedAt: 1,
  }))
  expect(await user.query(summary, args)).toMatchObject({ kind: 'automation' })
  await expect(t.withIdentity({ subject: 'user-b' }).query(personalChat, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await t.run(ctx => ctx.db.patch(automationId, { deletedAt: 0 }))
  expect(await user.query(summary, args)).toMatchObject({ kind: 'personal' })
})
