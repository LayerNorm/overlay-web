import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-ask-test-secret'
const now = 1_900_000_000_000
const workspaceId = 'workspace-asks'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const mutation = (name: string) => makeFunctionReference<'mutation'>(`agents/agentAsks:${name}`)
const query = (name: string) => makeFunctionReference<'query'>(`agents/agentAsks:${name}`)

describe('Convex agent ask budgets', () => {
  test('a question is taken from the request and the turn together, refused at either limit, and given back on release', async () => {
    const convex = convexTest(schema, modules)
    const claim = (args: Record<string, unknown> = {}) => convex.mutation(mutation('claimAgentAskByServer'), {
      serverSecret: secret, workspaceId, rootKey: 'root:r1', turnKey: 'turn:t1', maxRoot: 3, maxTurn: 2, now, ...args,
    }) as Promise<{ ok: boolean; reason?: string }>
    expect(await claim()).toEqual({ ok: true })
    expect(await claim()).toEqual({ ok: true })
    expect(await claim()).toEqual({ ok: false, reason: 'turn_limit' })
    // Another turn of the same request still has room under the request's limit of 3, then hits it.
    expect(await claim({ turnKey: 'turn:t2' })).toEqual({ ok: true })
    expect(await claim({ turnKey: 'turn:t2' })).toEqual({ ok: false, reason: 'budget' })
    // A refusal spent nothing.
    await convex.mutation(mutation('releaseAgentAskByServer'), { serverSecret: secret, workspaceId, rootKey: 'root:r1', turnKey: 'turn:t1', now })
    expect(await claim({ turnKey: 'turn:t3' })).toEqual({ ok: true })
    await expect(convex.mutation(mutation('claimAgentAskByServer'), {
      serverSecret: 'wrong', workspaceId, rootKey: 'a', turnKey: 'b', maxRoot: 1, maxTurn: 1, now,
    })).rejects.toThrow()
  })

  test('the replies a request started are remembered per request, newest last, and capped', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutation('claimAgentAskByServer'), { serverSecret: secret, workspaceId, rootKey: 'root:r1', turnKey: 'turn:t1', maxRoot: 99, maxTurn: 99, now })
    for (let i = 0; i < 45; i += 1) {
      await convex.mutation(mutation('recordAgentAskReplyByServer'), { serverSecret: secret, workspaceId, rootKey: 'root:r1', conversationId: 'c', turnId: `reply-${i}`, now })
    }
    const replies = await convex.query(query('listAgentAskRepliesByServer'), { serverSecret: secret, workspaceId, rootKey: 'root:r1' }) as Array<{ turnId: string }>
    expect(replies).toHaveLength(40)
    expect(replies.at(-1)!.turnId).toBe('reply-44')
    expect(await convex.query(query('listAgentAskRepliesByServer'), { serverSecret: secret, workspaceId, rootKey: 'root:none' })).toEqual([])
    // Recording for a request that never claimed is a no-op, not an error.
    await convex.mutation(mutation('recordAgentAskReplyByServer'), { serverSecret: secret, workspaceId, rootKey: 'root:none', conversationId: 'c', turnId: 'x', now })
  })
})
