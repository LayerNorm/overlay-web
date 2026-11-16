import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { compactAssistantPersistenceForConvex } from '../src/shared/chat/persist-assistant-turn'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-thread-pull-request-test-secret'
const bundle = makeFunctionReference<'query'>('agents/threads:bundle')
const resolveMain = makeFunctionReference<'mutation'>('agents/threads:resolveMain')
const completeTool = makeFunctionReference<'mutation'>('collaboration/directMessages:completeAgentToolInvocation')

beforeEach(() => vi.stubEnv('INTERNAL_API_SECRET', secret))
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', {
      workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active',
      createdAt: 1, updatedAt: 1,
    })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', {
        workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human',
        displayName: userId, createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('workspaceMemberships', {
        workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`,
        role: 'member', status: 'active', joinedAt: 1, updatedAt: 1,
      })
    }
    await ctx.db.insert('workspacePrincipals', {
      workspaceId: 'ws', principalId: 'ap-shared', agentId: 'shared', type: 'agent',
      displayName: 'Shared', createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('workspaceAgentDefinitions', {
      agentId: 'shared', workspaceId: 'ws', principalId: 'ap-shared', name: 'Shared',
      instructions: 'Help.', harness: 'overlay', modelId: 'model', allowedToolIds: [],
      invocationPolicy: 'mention', visibility: 'workspace', createdByPrincipalId: 'p-alice',
      createdAt: 1, updatedAt: 1,
    } as never)
  })
  return { t, as: (subject: string) => t.withIdentity({ subject }) }
}

test('server-authorized agent tool output appears only in the caller-owned thread bundle', async () => {
  const { t, as } = await fixture()
  const shared = { workspaceId: 'ws', agentId: 'shared' }
  await as('alice').mutation(resolveMain, shared)
  const initialAliceBundle = await as('alice').query(bundle, shared) as {
    threads: Array<{ conversationId: string }>
  }
  const aliceConversationId = initialAliceBundle.threads[0]!.conversationId
  const messageId = await t.run(ctx => ctx.db.insert('conversationMessages', {
    conversationId: aliceConversationId as never,
    userId: 'alice',
    authorKind: 'agent',
    authorPrincipalId: 'ap-shared',
    turnId: 'turn-1',
    role: 'assistant',
    mode: 'act',
    content: '',
    contentType: 'text',
    status: 'generating',
    parts: [{
      type: 'tool-invocation',
      toolInvocation: {
        toolCallId: 'github-create',
        toolName: 'call_mcp_tool',
        state: 'input-available',
        toolInput: {
          toolName: 'GITHUB_CREATE_A_PULL_REQUEST',
          arguments: { owner: 'LayerNorm', repo: 'overlay-web' },
        },
      },
    }],
    createdAt: 2,
    updatedAt: 2,
  }))

  await t.mutation(completeTool, {
    actorUserId: 'alice',
    authorPrincipalId: 'ap-shared',
    conversationId: aliceConversationId as never,
    messageId,
    turnId: 'turn-1',
    workspaceId: 'ws',
    toolCallId: 'github-create',
    toolName: 'call_mcp_tool',
    state: 'output-available',
    output: {
      structuredContent: {
        number: 42,
        html_url: 'https://github.com/LayerNorm/overlay-web/pull/42',
        title: 'Backend PR association',
        state: 'open',
        draft: false,
        updated_at: '2026-10-20T12:00:00Z',
      },
    },
    serverSecret: secret,
  })

  const aliceBundle = await as('alice').query(bundle, shared) as {
    threads: Array<{ conversationId: string; pullRequests?: Array<Record<string, unknown>> }>
  }
  expect(aliceBundle.threads.find(thread => thread.conversationId === aliceConversationId)?.pullRequests)
    .toMatchObject([{
      owner: 'LayerNorm',
      repo: 'overlay-web',
      number: 42,
      title: 'Backend PR association',
      url: 'https://github.com/LayerNorm/overlay-web/pull/42',
      state: 'open',
    }])

  await expect(t.mutation(completeTool, {
    actorUserId: 'bob',
    authorPrincipalId: 'ap-shared',
    conversationId: aliceConversationId as never,
    messageId,
    turnId: 'turn-1',
    workspaceId: 'ws',
    toolCallId: 'github-create',
    toolName: 'call_mcp_tool',
    state: 'output-available',
    output: { structuredContent: { merged: true } },
    serverSecret: secret,
  })).rejects.toThrow()

  const bobThread = await as('bob').mutation(resolveMain, shared) as { conversationId: string }
  const bobBundle = await as('bob').query(bundle, shared) as {
    threads: Array<{ conversationId: string; pullRequests?: unknown[] }>
  }
  expect(bobBundle.threads).toMatchObject([{ conversationId: bobThread.conversationId }])
  expect(bobBundle.threads[0]?.pullRequests).toBeUndefined()

  const forgedMessageId = await t.run(ctx => ctx.db.insert('conversationMessages', {
    conversationId: aliceConversationId as never,
    userId: 'alice',
    authorKind: 'agent',
    authorPrincipalId: 'ap-shared',
    turnId: 'forged-turn',
    role: 'assistant',
    mode: 'act',
    content: '',
    contentType: 'text',
    status: 'generating',
    parts: [{
      type: 'tool-invocation',
      toolInvocation: {
        toolCallId: 'forged',
        toolName: 'call_mcp_tool',
        state: 'input-available',
        toolInput: {
          toolName: 'GITHUB_CREATE_A_PULL_REQUEST',
          arguments: { owner: 'acme', repo: 'forged' },
        },
      },
    }],
    createdAt: 3,
    updatedAt: 3,
  }))
  await expect(as('alice').mutation(completeTool, {
    actorUserId: 'alice',
    authorPrincipalId: 'ap-shared',
    conversationId: aliceConversationId as never,
    messageId: forgedMessageId,
    turnId: 'forged-turn',
    workspaceId: 'ws',
    toolCallId: 'forged',
    toolName: 'call_mcp_tool',
    state: 'output-available',
    output: {
      structuredContent: {
        number: 99,
        html_url: 'https://github.com/acme/forged/pull/99',
        title: 'Forged result',
        state: 'open',
      },
    },
  })).rejects.toThrow('Unauthorized')

  const conversation = await t.run(ctx => ctx.db.get(aliceConversationId as never))
  expect(conversation?.pullRequests?.map(item => item.number)).toEqual([42])
  const forgedMessage = await t.run(ctx => ctx.db.get(forgedMessageId))
  expect((forgedMessage?.parts?.[0] as { toolInvocation?: { state?: string } })?.toolInvocation?.state)
    .toBe('input-available')
})

test('compacted router results project through normal agent append and finalization writes', async () => {
  for (const method of ['appendAgentMessageDelta', 'finalizeAgentMessage']) {
    const { t, as } = await fixture()
    const agent = { workspaceId: 'ws', agentId: 'shared' }
    const { conversationId } = await as('alice').mutation(resolveMain, agent) as { conversationId: string }
    const messageId = await t.run(ctx => ctx.db.insert('conversationMessages', {
      conversationId: conversationId as never, userId: 'alice', authorKind: 'agent',
      authorPrincipalId: 'ap-shared', turnId: 'router-turn', role: 'assistant', mode: 'act',
      content: '', contentType: 'text', status: 'generating', parts: [], createdAt: 2, updatedAt: 2,
    }))
    await t.run(async ctx => {
      const userMessageId = await ctx.db.insert('conversationMessages', {
        conversationId: conversationId as never, userId: 'alice', role: 'user', mode: 'act', turnId: 'router-turn',
        content: 'Create a draft PR.', contentType: 'text', status: 'completed', createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('conversationAgentRuns', {
        conversationId: conversationId as never, turnId: 'router-turn', userId: 'alice',
        userMessageId, assistantMessageId: messageId, mode: 'room', runner: 'workflow',
        executionEngine: 'overlay_harness', status: 'running', agentId: 'shared',
        agentPrincipalId: 'ap-shared', createdAt: 2, updatedAt: 2,
      })
    })
    const saved = compactAssistantPersistenceForConvex({ content: '', parts: [{
      type: 'tool-invocation', toolInvocation: {
        toolCallId: 'router-create', toolName: 'COMPOSIO_MULTI_EXECUTE_TOOL', state: 'output-available',
        toolInput: { tools: [{ tool_slug: 'GITHUB_CREATE_A_PULL_REQUEST', arguments: {
          owner: 'DevelopedByDev', repo: 'autoquill_ai', draft: true,
        } }] },
        toolOutput: { successful: true, error: null, data: { results: [{
          tool_slug: 'GITHUB_CREATE_A_PULL_REQUEST', index: 0, response: {
            successful: true, error: null, data: JSON.stringify({
              number: 4, html_url: 'https://github.com/DevelopedByDev/autoquill_ai/pull/4',
              title: 'Draft PR', state: 'open', draft: true, body: 'Long body. '.repeat(800),
            }),
          },
        }] } },
      },
    }] })
    await t.mutation(makeFunctionReference<'mutation'>(`collaboration/directMessages:${method}`), {
      actorUserId: 'alice', conversationId: conversationId as never, messageId, workspaceId: 'ws',
      serverSecret: secret, parts: saved.parts,
      ...(method === 'appendAgentMessageDelta' ? { contentDelta: '' } : { content: 'Created draft PR.' }),
    })
    const result = await as('alice').query(bundle, agent) as {
      threads: Array<{ pullRequests?: Array<{ url: string; state: string }> }>
    }
    expect(result.threads[0]?.pullRequests).toMatchObject([{
      url: 'https://github.com/DevelopedByDev/autoquill_ai/pull/4', state: 'draft',
    }])
  }
})
