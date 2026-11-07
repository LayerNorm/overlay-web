import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const query = (name: string) => makeFunctionReference<'query'>(name)
afterEach(() => vi.unstubAllEnvs())

test('authorized personal, automation, and room readers see sequenced snapshots; revocation fails closed', async () => {
  const convex = convexTest(schema, modules)
  const ids = await convex.run(async ctx => {
    const now = 1
    await ctx.db.insert('authorizationRoles', {
      roleId: 'member', name: 'Member', capabilities: ['conversations.read'],
      isSystem: true, createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('authorizationUserRoles', { roleId: 'member', userId: 'owner', createdAt: now })
    await ctx.db.insert('workspaces', {
      workspaceId: 'ws', kind: 'organization', name: 'Test', slug: 'test', status: 'active',
      createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      workspaceId: 'ws', principalId: 'p-owner', userId: 'owner', type: 'human',
      displayName: 'Owner', createdAt: now, updatedAt: now,
    })
    const membershipId = await ctx.db.insert('workspaceMemberships', {
      workspaceId: 'ws', principalId: 'p-owner', membershipId: 'm-owner', role: 'owner',
      status: 'active', joinedAt: now, updatedAt: now,
    })
    const conversation = (fields: Record<string, unknown>) => ctx.db.insert('conversations', {
      userId: 'owner', workspaceId: 'ws', title: 'Test', lastModified: now, createdAt: now,
      lastMode: 'act', askModelIds: ['model'], actModelId: 'model', ...fields,
    } as never)
    const personal = await conversation({})
    const automation = await conversation({ isAutomation: true })
    const room = await conversation({ conversationType: 'channel', scope: 'workspace' })
    const addStream = async (conversationId: typeof personal, runId: string) => {
      const assistantMessageId = await ctx.db.insert('conversationMessages', {
        conversationId, userId: 'owner', turnId: runId, role: 'assistant', mode: 'act',
        content: '', contentType: 'text', status: 'generating', createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('harnessPublicStreams', {
        runId, workflowRunId: `workflow:${runId}`, executionGeneration: 2, receiptId: 'model:0',
        invocation: 0, conversationId, assistantMessageId, nextSequence: 2, lastSequence: 1,
        lastText: 'Live answer', nextSegmentIndex: 1, visibleCharacters: 11, truncated: false,
        active: true, updatedAt: now,
      })
      await ctx.db.insert('harnessPublicStreamSegments', {
        runId, workflowRunId: `workflow:${runId}`, executionGeneration: 2, receiptId: 'model:0',
        segmentIndex: 0, firstSequence: 0, lastSequence: 1, text: 'Live answer',
        createdAt: now, updatedAt: now,
      })
      return assistantMessageId
    }
    const personalMessage = await addStream(personal, 'personal:run')
    const automationMessage = await addStream(automation, 'automation:run')
    const roomMessage = await addStream(room, 'workspace:run')
    await ctx.db.insert('conversationParticipants', {
      conversationId: room, workspaceId: 'ws', principalId: 'p-owner', principalType: 'human',
      role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now,
    })
    return { personal, automation, room, personalMessage, automationMessage, roomMessage, membershipId }
  })
  const owner = convex.withIdentity({ subject: 'owner' })
  const personalStreams = query('chat/personal:activePublicStreams')
  const roomStreams = query('collaboration/rooms:activePublicStreams')

  await expect(owner.query(personalStreams, {
    workspaceId: 'ws', conversationId: ids.personal, messageIds: [ids.personalMessage],
  })).resolves.toMatchObject([{ text: 'Live answer', executionGeneration: 2, sequence: 1 }])
  await expect(owner.query(personalStreams, {
    workspaceId: 'ws', conversationId: ids.automation, messageIds: [ids.automationMessage],
  })).resolves.toMatchObject([{ text: 'Live answer' }])
  await expect(owner.query(roomStreams, {
    workspaceId: 'ws', conversationId: ids.room, messageIds: [ids.roomMessage],
  })).resolves.toMatchObject([{ text: 'Live answer' }])

  const outsider = convex.withIdentity({ subject: 'outsider' })
  await expect(outsider.query(personalStreams, {
    workspaceId: 'ws', conversationId: ids.personal, messageIds: [ids.personalMessage],
  })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await convex.run(async ctx => {
    await ctx.db.patch(ids.membershipId, { status: 'suspended' })
  })
  await expect(owner.query(personalStreams, {
    workspaceId: 'ws', conversationId: ids.personal, messageIds: [ids.personalMessage],
  })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await expect(owner.query(roomStreams, {
    workspaceId: 'ws', conversationId: ids.room, messageIds: [ids.roomMessage],
  })).resolves.toEqual([])
})
