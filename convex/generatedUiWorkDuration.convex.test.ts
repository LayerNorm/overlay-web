import { beforeAll, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'generated-ui-work-duration-test'
const legacyPersonalSave = makeFunctionReference<'mutation'>('chat/conversations:updateMessageUiPart')
const legacyPersonalMessages = makeFunctionReference<'query'>('chat/conversations:getMessages')
const personalUiSave = makeFunctionReference<'mutation'>('chat/personal:setGeneratedUi')
const personalUiMessages = makeFunctionReference<'query'>('chat/personal:getMessages')
const nativeSave = makeFunctionReference<'mutation'>('collaboration/rooms:updateMessageUiPart')
const nativeMessage = makeFunctionReference<'query'>('collaboration/rooms:message')
const form = {
  version: 1 as const,
  kind: 'json_render' as const,
  catalogVersion: 1,
  title: 'Name',
  summary: 'Enter a name.',
  specJson: '{"root":"name","elements":{"name":{"type":"Input","props":{"label":"Name"}}}}',
}
const inflatedUpdatedAt = 114_242
const originalRunCompletedAt = 58_208

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function personalFixture(withRun: boolean) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const conversationId = await ctx.db.insert('conversations', {
      userId: 'owner', title: 'Form', askModelIds: [], actModelId: 'model', lastMode: 'act',
      createdAt: 1_000, updatedAt: 1_000, lastModified: 1_000,
    })
    const rootId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', turnId: 'request', role: 'user', mode: 'act', contentType: 'text',
      content: 'Please fill out this form.', createdAt: 1_000,
    })
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', turnId: 'answer', role: 'assistant', mode: 'act', contentType: 'text',
      content: 'Here is the form.', status: 'completed', createdAt: 1_000, updatedAt: inflatedUpdatedAt,
      parts: [{ type: 'data', id: 'view', dataType: 'overlay.generated_ui', data: form }],
    })
    if (withRun) {
      await ctx.db.insert('conversationAgentRuns', {
        conversationId, turnId: 'answer', userId: 'owner', userMessageId: rootId, assistantMessageId: messageId,
        mode: 'chat', runner: 'workflow', executionEngine: 'overlay_harness', status: 'completed',
        createdAt: 1_000, updatedAt: originalRunCompletedAt, completedAt: originalRunCompletedAt,
      })
    }
    return { conversationId, messageId }
  })
  return {
    t,
    ...ids,
    args: {
      ...ids, userId: 'owner', serverSecret: secret, partId: 'view',
      data: { ...form, stateJson: '{"name":"Edited"}' },
    },
  }
}

async function personalUiFixture(withRun: boolean) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('authorizationRoles', {
      roleId: 'member', name: 'Member', capabilities: ['conversations.read', 'conversations.edit'],
      isSystem: false, createdAt: 1_000, updatedAt: 1_000,
    })
    await ctx.db.insert('authorizationUserRoles', { roleId: 'member', userId: 'owner', createdAt: 1_000 })
    await ctx.db.insert('workspaces', {
      workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active',
      createdAt: 1_000, updatedAt: 1_000,
    })
    await ctx.db.insert('workspacePrincipals', {
      workspaceId: 'ws', principalId: 'p-owner', userId: 'owner', type: 'human',
      displayName: 'Owner', createdAt: 1_000, updatedAt: 1_000,
    })
    await ctx.db.insert('workspaceMemberships', {
      workspaceId: 'ws', principalId: 'p-owner', membershipId: 'm-owner', role: 'member',
      status: 'active', joinedAt: 1_000, updatedAt: 1_000,
    })
    const conversationId = await ctx.db.insert('conversations', {
      workspaceId: 'ws', userId: 'owner', title: 'Form', askModelIds: [], actModelId: 'model',
      lastMode: 'act', createdAt: 1_000, updatedAt: 1_000, lastModified: 1_000,
    })
    const userMessageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', turnId: 'request', role: 'user', mode: 'act', contentType: 'text',
      content: 'Please fill out this form.', createdAt: 1_000,
    })
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', turnId: 'answer', role: 'assistant', mode: 'act', contentType: 'text',
      content: 'Here is the form.', status: 'completed', createdAt: 1_000, updatedAt: inflatedUpdatedAt,
      parts: [{ type: 'data', id: 'view', dataType: 'overlay.generated_ui', data: form }],
    })
    if (withRun) {
      await ctx.db.insert('conversationAgentRuns', {
        conversationId, turnId: 'answer', userId: 'owner', userMessageId, assistantMessageId: messageId,
        mode: 'chat', runner: 'workflow', executionEngine: 'overlay_harness', status: 'completed',
        createdAt: 1_000, updatedAt: originalRunCompletedAt, completedAt: originalRunCompletedAt,
      })
    }
    return { conversationId, messageId }
  })
  return {
    t,
    ...ids,
    owner: t.withIdentity({ subject: 'owner' }),
    outsider: t.withIdentity({ subject: 'outsider' }),
    args: {
      workspaceId: 'ws', ...ids, partId: 'view',
      data: { ...form, stateJson: '{"name":"Edited"}' },
    },
  }
}

async function nativeFixture(withRun: boolean) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    for (const userId of ['member', 'outsider']) {
      await ctx.db.insert('workspacePrincipals', {
        workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1_000, updatedAt: 1_000,
      })
      await ctx.db.insert('workspaceMemberships', {
        workspaceId: 'ws', principalId: `p-${userId}`, membershipId: userId, role: 'member', status: 'active', joinedAt: 1_000, updatedAt: 1_000,
      })
    }
    const conversationId = await ctx.db.insert('conversations', {
      workspaceId: 'ws', userId: 'owner', conversationType: 'channel', title: 'Form', askModelIds: [], actModelId: 'model',
      lastMode: 'act', createdAt: 1_000, updatedAt: 1_000, lastModified: 1_000,
    })
    await ctx.db.insert('conversationParticipants', {
      conversationId, workspaceId: 'ws', principalId: 'p-member', principalType: 'human', role: 'member', status: 'active',
      notificationLevel: 'all', joinedAt: 1_000, updatedAt: 1_000,
    })
    const rootId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', turnId: 'request', role: 'user', mode: 'act', contentType: 'text',
      content: 'Please fill out this form.', createdAt: 1_000,
    })
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', threadRootMessageId: rootId, turnId: 'answer', role: 'assistant', mode: 'act',
      contentType: 'text', content: 'Here is the form.', status: 'completed', createdAt: 1_000, updatedAt: inflatedUpdatedAt,
      parts: [{ type: 'data', id: 'view', dataType: 'overlay.generated_ui', data: form }],
    })
    if (withRun) {
      await ctx.db.insert('conversationAgentRuns', {
        conversationId, turnId: 'answer', userId: 'owner', userMessageId: rootId, assistantMessageId: messageId,
        mode: 'room', runner: 'workflow', executionEngine: 'overlay_harness', status: 'completed',
        createdAt: 1_000, updatedAt: originalRunCompletedAt, completedAt: originalRunCompletedAt,
      })
    }
    return { conversationId, messageId }
  })
  return {
    t,
    ...ids,
    member: t.withIdentity({ subject: 'member' }),
    args: { workspaceId: 'ws', ...ids, partId: 'view', data: { ...form, stateJson: '{"name":"Edited"}' } },
  }
}

test('legacy personal message updates backfill the linked run completion and preserve it on submit', async () => {
  const { t, args, conversationId, messageId } = await personalFixture(true)
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(200_000)
    await t.mutation(legacyPersonalSave, args)
    const first = await t.run(ctx => ctx.db.get(messageId))
    expect(first).toMatchObject({ completedAt: originalRunCompletedAt, updatedAt: 200_000 })
    const projected = await t.query(legacyPersonalMessages, { conversationId, userId: 'owner', serverSecret: secret })
    expect(projected.find(message => message._id === messageId)).toMatchObject({ completedAt: originalRunCompletedAt })

    vi.setSystemTime(300_000)
    await t.mutation(legacyPersonalSave, {
      ...args,
      data: { ...args.data, stateJson: '{"name":"Submitted"}', submittedAt: 299_000 },
    })
    const second = await t.run(ctx => ctx.db.get(messageId))
    expect(second).toMatchObject({ completedAt: originalRunCompletedAt, updatedAt: 300_000 })
    expect(second?.updatedAt).toBeGreaterThan(first?.updatedAt ?? 0)
  } finally {
    vi.useRealTimers()
  }
})

test('legacy personal message updates use the prior updatedAt for completed messages without a linked run', async () => {
  const { t, args, messageId } = await personalFixture(false)
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(200_000)
    await t.mutation(legacyPersonalSave, args)
    expect(await t.run(ctx => ctx.db.get(messageId))).toMatchObject({ completedAt: inflatedUpdatedAt, updatedAt: 200_000 })
  } finally {
    vi.useRealTimers()
  }
})

test('native personal form saves backfill linked completion through the transcript query and preserve it on submit', async () => {
  const { owner, args, conversationId, messageId } = await personalUiFixture(true)
  const queryArgs = { workspaceId: 'ws', conversationId, paginationOpts: { numItems: 50, cursor: null } }
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(200_000)
    await owner.mutation(personalUiSave, args)
    const firstPage = await owner.query(personalUiMessages, queryArgs)
    const first = firstPage.page.find(row => row.message._id === messageId)?.message
    expect(first).toMatchObject({ completedAt: originalRunCompletedAt, updatedAt: 200_000 })

    vi.setSystemTime(300_000)
    await owner.mutation(personalUiSave, {
      ...args,
      data: { ...args.data, stateJson: '{"name":"Submitted"}', submittedAt: 299_000 },
    })
    const secondPage = await owner.query(personalUiMessages, queryArgs)
    const second = secondPage.page.find(row => row.message._id === messageId)?.message
    expect(second).toMatchObject({ completedAt: originalRunCompletedAt, updatedAt: 300_000 })
    expect(second?.updatedAt).toBeGreaterThan(first?.updatedAt ?? 0)
  } finally {
    vi.useRealTimers()
  }
})

test('native personal form saves use the prior updatedAt for completed messages without a linked run', async () => {
  const { owner, args, conversationId, messageId } = await personalUiFixture(false)
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(200_000)
    await owner.mutation(personalUiSave, args)
    const page = await owner.query(personalUiMessages, {
      workspaceId: 'ws', conversationId, paginationOpts: { numItems: 50, cursor: null },
    })
    expect(page.page.find(row => row.message._id === messageId)?.message)
      .toMatchObject({ completedAt: inflatedUpdatedAt, updatedAt: 200_000 })
  } finally {
    vi.useRealTimers()
  }
})

test('native personal generated-form edits still reject a viewer outside the workspace', async () => {
  const { t, outsider, args, messageId } = await personalUiFixture(true)
  await expect(outsider.mutation(personalUiSave, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  expect(await t.run(ctx => ctx.db.get(messageId))).toMatchObject({ updatedAt: inflatedUpdatedAt })
})

test('native form saves backfill the linked run completion, preserve it on submit, and project it through room messages', async () => {
  const { t, member, args, conversationId, messageId } = await nativeFixture(true)
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(200_000)
    await member.mutation(nativeSave, args)
    const first = await t.run(ctx => ctx.db.get(messageId))
    expect(first).toMatchObject({ completedAt: originalRunCompletedAt, updatedAt: 200_000 })
    const projected = await member.query(nativeMessage, { workspaceId: 'ws', conversationId, messageId })
    expect(projected).toMatchObject({ completedAt: originalRunCompletedAt, updatedAt: 200_000 })

    vi.setSystemTime(300_000)
    await member.mutation(nativeSave, {
      ...args,
      data: { ...args.data, stateJson: '{"name":"Submitted"}', submittedAt: 299_000 },
    })
    const second = await t.run(ctx => ctx.db.get(messageId))
    expect(second).toMatchObject({ completedAt: originalRunCompletedAt, updatedAt: 300_000 })
    expect(second?.updatedAt).toBeGreaterThan(first?.updatedAt ?? 0)
  } finally {
    vi.useRealTimers()
  }
})

test('native form saves use the prior updatedAt for completed legacy messages without a linked run', async () => {
  const { t, member, args, messageId } = await nativeFixture(false)
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(200_000)
    await member.mutation(nativeSave, args)
    expect(await t.run(ctx => ctx.db.get(messageId))).toMatchObject({ completedAt: inflatedUpdatedAt, updatedAt: 200_000 })
  } finally {
    vi.useRealTimers()
  }
})
