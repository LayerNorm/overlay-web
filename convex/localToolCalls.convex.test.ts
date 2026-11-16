import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'local-tool-calls-test-secret'
const now = 1_000_000
const workspaceId = 'workspace-local'
const environmentId = 'environment-mac'
const owner = 'owner-user'
const mutationRef = (name: string) => makeFunctionReference<'mutation'>(`agents/localToolCalls:${name}`)
const queryRef = (name: string) => makeFunctionReference<'query'>(`agents/localToolCalls:${name}`)
const request = { kind: 'exec', command: 'ls', timeoutMs: 5_000 }

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function setup(overrides: Record<string, unknown> = {}) {
  const convex = convexTest(schema, modules)
  await convex.run(async ctx => {
    await ctx.db.insert('agentEnvironments', {
      environmentId, workspaceId, kind: 'local', name: 'Dev MacBook', status: 'online', approvedAt: now,
      approvedByUserId: owner, lastSeenAt: now, filesystemGrant: { mode: 'all_user_files' },
      capabilities: { localTools: { version: 1, os: 'darwin', features: ['exec'], homeDirectory: '/Users/dev' } },
      createdAt: now, updatedAt: now, ...overrides,
    })
    for (const [userId, principalId] of [[owner, 'principal-owner'], ['other-user', 'principal-other']]) {
      await ctx.db.insert('workspacePrincipals', { principalId, workspaceId, type: 'human', userId, displayName: String(userId), createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { membershipId: `membership-${principalId}`, workspaceId, principalId, role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    }
  })
  return convex
}

const enqueue = (convex: Awaited<ReturnType<typeof setup>>, args: Record<string, unknown> = {}) => convex.mutation(mutationRef('enqueueByServer'), {
  serverSecret: secret, callId: 'call-1', workspaceId, environmentId, requestedByUserId: owner,
  toolName: 'computer_exec', request, deadlineAt: now + 30_000, now, ...args,
})

describe('local tool calls', () => {
  test('a call is claimed once, answered once and read back by the waiting server', async () => {
    const convex = await setup()
    await enqueue(convex)
    const claimArgs = { serverSecret: secret, workspaceId, environmentId, limit: 10, now: now + 10 }
    const claimed = await convex.mutation(mutationRef('claimByServer'), claimArgs)
    expect(claimed).toEqual([{ callId: 'call-1', workspaceId, environmentId, issuedAt: now, deadlineAt: now + 30_000, request }])
    expect(await convex.mutation(mutationRef('claimByServer'), claimArgs)).toEqual([])
    const outcome = { ok: true, result: { stdout: 'a\n', stderr: '', exitCode: 0, startedAt: now, endedAt: now, truncated: false } }
    const complete = { serverSecret: secret, workspaceId, environmentId, callId: 'call-1', outcome, now: now + 20 }
    expect(await convex.mutation(mutationRef('completeByServer'), complete)).toEqual({ accepted: true })
    expect(await convex.mutation(mutationRef('completeByServer'), complete)).toEqual({ accepted: true })
    expect(await convex.query(queryRef('getByServer'), { serverSecret: secret, workspaceId, callId: 'call-1' })).toEqual({ status: 'completed', outcome })
  })

  test('only the person who approved the machine can send it calls, and only while it advertises local tools', async () => {
    const convex = await setup()
    await expect(enqueue(convex, { requestedByUserId: 'other-user' })).rejects.toThrow(/LOCAL_TOOLS_FORBIDDEN/)
    const revoked = await setup({ status: 'revoked', revokedAt: now })
    await expect(enqueue(revoked)).rejects.toThrow(/LOCAL_TOOLS_ENVIRONMENT_UNAVAILABLE/)
    const withoutTools = await setup({ capabilities: {} })
    await expect(enqueue(withoutTools)).rejects.toThrow(/LOCAL_TOOLS_UNSUPPORTED/)
    const server = await setup({ kind: 'vps' })
    await expect(enqueue(server)).rejects.toThrow(/LOCAL_TOOLS_FORBIDDEN/)
    await expect(enqueue(convex, { deadlineAt: now + 60 * 60_000 })).rejects.toThrow(/LOCAL_TOOLS_DEADLINE_INVALID/)
  })

  test('a call past its deadline is expired instead of delivered, and a late answer is refused', async () => {
    const convex = await setup()
    await enqueue(convex)
    expect(await convex.mutation(mutationRef('claimByServer'), { serverSecret: secret, workspaceId, environmentId, limit: 10, now: now + 31_000 })).toEqual([])
    expect(await convex.query(queryRef('getByServer'), { serverSecret: secret, workspaceId, callId: 'call-1' })).toEqual({ status: 'expired' })
    expect(await convex.mutation(mutationRef('completeByServer'), { serverSecret: secret, workspaceId, environmentId, callId: 'call-1',
      outcome: { ok: true, result: {} }, now: now + 32_000 })).toEqual({ accepted: false })
  })

  test('the waiting server can give up; an answer that already arrived is kept', async () => {
    const convex = await setup()
    await enqueue(convex)
    expect(await convex.mutation(mutationRef('expireByServer'), { serverSecret: secret, workspaceId, callId: 'call-1', now: now + 5 })).toEqual({ status: 'expired' })
    await enqueue(convex, { callId: 'call-2' })
    await convex.mutation(mutationRef('claimByServer'), { serverSecret: secret, workspaceId, environmentId, limit: 10, now: now + 10 })
    const outcome = { ok: false, error: { code: 'not_found', message: 'That path does not exist.' } }
    await convex.mutation(mutationRef('completeByServer'), { serverSecret: secret, workspaceId, environmentId, callId: 'call-2', outcome, now: now + 20 })
    expect(await convex.mutation(mutationRef('expireByServer'), { serverSecret: secret, workspaceId, callId: 'call-2', now: now + 30 })).toEqual({ status: 'completed', outcome })
  })

  test('another environment cannot claim or answer a call', async () => {
    const convex = await setup()
    await convex.run(ctx => ctx.db.insert('agentEnvironments', {
      environmentId: 'environment-other', workspaceId, kind: 'local', name: 'Other', status: 'online', approvedAt: now,
      approvedByUserId: 'other-user', capabilities: {}, createdAt: now, updatedAt: now,
    }))
    await enqueue(convex)
    expect(await convex.mutation(mutationRef('claimByServer'), { serverSecret: secret, workspaceId, environmentId: 'environment-other', limit: 10, now })).toEqual([])
    await expect(convex.mutation(mutationRef('completeByServer'), { serverSecret: secret, workspaceId, environmentId: 'environment-other',
      callId: 'call-1', outcome: { ok: true, result: {} }, now })).rejects.toThrow(/LOCAL_TOOLS_CALL_NOT_FOUND/)
  })
})
