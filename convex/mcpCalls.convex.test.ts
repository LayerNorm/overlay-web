import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { convexTest } from 'convex-test'
import schema from './schema'
import { api, internal } from './_generated/api'
import { McpCallJournal } from '../src/server/agents/McpCallJournal'
vi.mock('server-only', () => ({}))
const modules = import.meta.glob('./**/*.ts')
const secret = 'mcp-journal-test-only'
beforeEach(() => { process.env.INTERNAL_API_SECRET = secret })
afterEach(() => vi.useRealTimers())
async function fixture() {
  const convex = convexTest(schema, modules)
  const now = Date.now()
  const ids = await convex.run(async ctx => {
    const workspace = await ctx.db.insert('workspaces', { workspaceId: 'w', kind: 'organization', name: 'Test', slug: 'test', status: 'active', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: 'p', workspaceId: 'w', userId: 'u', type: 'human', displayName: 'Test', createdAt: now, updatedAt: now })
    const membership = await ctx.db.insert('workspaceMemberships', { membershipId: 'member', workspaceId: 'w', principalId: 'p', role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    const agent = await ctx.db.insert('workspaceAgentDefinitions', { agentId: 'a', workspaceId: 'w', principalId: 'ap', name: 'Test', instructions: '', harness: 'codex', modelId: 'byo/codex', allowedToolIds: [], invocationPolicy: 'mention', visibility: 'creator', createdByPrincipalId: 'p', createdAt: now, updatedAt: now })
    const environment = await ctx.db.insert('agentEnvironments', { environmentId: 'e', workspaceId: 'w', kind: 'overlay_cloud', name: 'Test', status: 'online', capabilities: {}, createdAt: now, updatedAt: now })
    const binding = await ctx.db.insert('agentBindings', { bindingId: 'b', workspaceId: 'w', agentId: 'a', environmentId: 'e', protocolAdapter: 'acp', adapterConfig: {}, enabled: true, createdAt: now, updatedAt: now })
    const conversationId = await ctx.db.insert('conversations', { userId: 'u', workspaceId: 'w', title: 'Test', lastModified: now, createdAt: now, updatedAt: now, lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free' })
    const messageId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'u', turnId: 't', role: 'assistant', mode: 'act', content: '', contentType: 'text', status: 'generating', createdAt: now, updatedAt: now })
    const run = await ctx.db.insert('conversationAgentRuns', { externalRunId: 'r', conversationId, userId: 'u', userMessageId: messageId, assistantMessageId: messageId, turnId: 't', agentId: 'a', environmentId: 'e', bindingId: 'b', mode: 'room', runner: 'remote', status: 'running', createdAt: now, updatedAt: now })
    const session = await ctx.db.insert('agentRemoteSessions', { sessionId: 's', workspaceId: 'w', environmentId: 'e', bindingId: 'b', runId: 'r', status: 'running', attemptId: 's', executionGeneration: 1, hardDeadlineAt: now + 600000, commandCursor: 0, eventCursor: 0, capabilitySnapshot: {}, createdAt: now, updatedAt: now })
    const participant = await ctx.db.insert('conversationParticipants', { conversationId, workspaceId: 'w', principalId: 'p', principalType: 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    return { workspace, membership, agent, environment, binding, run, session, participant }
  })
  const auth = { serverSecret: secret, workspaceId: 'w', environmentId: 'e', runId: 'r', sessionId: 's', expiresAt: now + 500000, execution: { attemptId: 's', generation: 1 } }
  const args = { ...auth, clientSessionId: 'client', rpcId: '1', callId: 'call', toolName: 'test_write', argumentsJson: '{"text":"🙂"}' }
  return { convex, ids, auth, args, register: () => convex.mutation(api.agents.mcpCalls.register, args),
    claim: (patch = {}) => convex.mutation(api.agents.mcpCalls.claim, { ...auth, callId: 'call', executionId: 'owner', approvalRequired: false, ...patch }) }
}

test('a retried RPC request returns its original call; reusing its id cannot change arguments', async () => {
  const f = await fixture()
  expect(await f.register()).toMatchObject({ callId: 'call', state: { kind: 'pending' } })
  expect(await f.convex.mutation(api.agents.mcpCalls.register, { ...f.args, callId: 'new-call' })).toMatchObject({ callId: 'call' })
  await expect(f.convex.mutation(api.agents.mcpCalls.register, { ...f.args, argumentsJson: '{}' })).rejects.toMatchObject({ data: 'MCP_CALL_ID_REUSED' })
})

test('one executor wins and an expired executor can never be replaced automatically', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const f = await fixture(); await f.register()
  expect(await f.claim()).toBe(true)
  expect(await f.claim({ executionId: 'other' })).toBe(false)
  vi.setSystemTime(Date.now() + 241000)
  expect(await f.claim({ executionId: 'other' })).toBe(false)
  const read = await f.convex.query(api.agents.mcpCalls.read, { ...f.auth, callId: 'call' })
  expect(read.state).toMatchObject({ kind: 'executing', executionId: 'owner' })
})

test('approval-gated execution requires the actual canonical decision for this call', async () => {
  const f = await fixture(); const call = await f.register()
  await expect(f.claim({ approvalRequired: true })).rejects.toMatchObject({ data: 'MCP_CALL_NOT_APPROVED' })
  await f.convex.run(ctx => ctx.db.insert('agentApprovalRequests', { approvalId: 'decision', workspaceId: 'w', runId: 'r', remoteSessionId: 's', requestKey: call.requestKey, prompt: 'Allow?', kind: 'permission', options: ['allow','deny'], payload: {}, requestedAt: Date.now(), resolution: { decision: 'allow', resolvedByPrincipalId: 'p', resolvedAt: Date.now() } }))
  expect(await f.claim({ approvalRequired: true })).toBe(true)
})

test('large exact results publish atomically as bounded immutable chunks', async () => {
  const f = await fixture(); await f.register(); await f.claim()
  const data = new TextEncoder().encode('🙂 exact full result '.repeat(50000))
  const parts: ArrayBuffer[] = []
  for (let at=0;at<data.length;at+=65536) parts.push(data.slice(at,at+65536).buffer)
  const base = { ...f.auth, callId:'call', executionId:'owner' }
  await expect(f.convex.query(api.agents.mcpCalls.readResult, { ...f.auth, callId:'call', start:0 })).rejects.toMatchObject({ data:'MCP_CALL_RESULT_UNAVAILABLE' })
  await expect(f.convex.mutation(api.agents.mcpCalls.appendResult, { ...base, index:1, data:parts[0]! })).rejects.toMatchObject({ data:'MCP_CALL_RESULT_ORDER' })
  for (let index=0;index<parts.length;index++) await f.convex.mutation(api.agents.mcpCalls.appendResult, { ...base,index,data:parts[index]! })
  await f.convex.mutation(api.agents.mcpCalls.appendResult, { ...base,index:0,data:parts[0]! })
  await expect(f.convex.mutation(api.agents.mcpCalls.appendResult, { ...base,index:0,data:new Uint8Array([1]).buffer })).rejects.toMatchObject({ data:'MCP_CALL_RESULT_CHANGED' })
  const complete = { ...base,chunks:parts.length,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex') }
  await expect(f.convex.mutation(api.agents.mcpCalls.complete,{...complete,bytes:1})).rejects.toMatchObject({ data:'MCP_CALL_RESULT_INCOMPLETE' })
  await f.convex.mutation(api.agents.mcpCalls.complete,complete)
  await f.convex.mutation(api.agents.mcpCalls.complete,complete)
  const result: Uint8Array[]=[]
  for(let start=0;start<parts.length;start+=8){const page=await f.convex.query(api.agents.mcpCalls.readResult,{...f.auth,callId:'call',start});expect(page.length).toBeLessThanOrEqual(8);result.push(...page.map(p=>new Uint8Array(p.data)))}
  expect(Buffer.concat(result).equals(Buffer.from(data))).toBe(true)
  expect(await f.claim({executionId:'reconnected'})).toBe(false)
})

test('membership removal, environment revocation, and stale attempts revoke journal access', async () => {
  const f = await fixture(); await f.register()
  await expect(f.convex.query(api.agents.mcpCalls.read,{...f.auth,workspaceId:'other',callId:'call'})).rejects.toMatchObject({data:'MCP_CALL_UNAUTHORIZED'})
  await expect(f.convex.query(api.agents.mcpCalls.read,{...f.auth,execution:{attemptId:'s',generation:2},callId:'call'})).rejects.toMatchObject({data:'MCP_CALL_UNAUTHORIZED'})
  await f.convex.run(ctx=>ctx.db.patch(f.ids.membership,{status:'suspended'}))
  await expect(f.convex.query(api.agents.mcpCalls.read,{...f.auth,callId:'call'})).rejects.toMatchObject({data:'MCP_CALL_UNAUTHORIZED'})
  await f.convex.run(ctx=>ctx.db.patch(f.ids.membership,{status:'active'}))
  await f.convex.run(ctx=>ctx.db.patch(f.ids.environment,{revokedAt:Date.now()}))
  await expect(f.convex.query(api.agents.mcpCalls.read,{...f.auth,callId:'call'})).rejects.toMatchObject({data:'MCP_CALL_UNAUTHORIZED'})
})

test('a run has a bounded journal budget and expired results are removed', async () => {
  vi.useFakeTimers({toFake:['Date']})
  const f=await fixture();await f.register();await f.claim()
  await f.convex.run(async ctx=>{const budget=await ctx.db.query('agentMcpCallBudgets').first();if(!budget)throw Error('No budget');await ctx.db.patch(budget._id,{bytes:64*1024*1024})})
  await expect(f.convex.mutation(api.agents.mcpCalls.appendResult,{...f.auth,callId:'call',executionId:'owner',index:0,data:new Uint8Array([1]).buffer})).rejects.toMatchObject({data:'MCP_CALL_QUOTA'})
  vi.setSystemTime(Date.now()+2*24*60*60000)
  await f.convex.mutation(internal.agents.mcpCalls.cleanupExpired,{})
  expect(await f.convex.run(ctx=>ctx.db.query('agentMcpCalls').collect())).toEqual([])
  expect(await f.convex.run(ctx=>ctx.db.query('agentMcpCallBudgets').collect())).toEqual([])
})

test('a fresh server journal reconstructs an exact large result without claiming execution again', async () => {
  const f = await fixture()
  const claims = { ...f.auth, userId: 'u', agentId: 'a', agentPrincipalId: 'ap', conversationId: 'conversation', turnId: 'turn',
    invocationNonce: 'invocation', modelId: 'byo/codex', memoryEnabled: false, grant: { allowedToolIds: [], isDefaultMaster: false } }
  const first = new McpCallJournal(claims, f.convex, secret)
  const call = await first.register('client', 7, 'test_write', { z: 2, a: '🙂' })
  expect(await first.claim(call.callId, 'owner', false)).toBe(true)
  const result = { content: [{ type: 'text' as const, text: '🙂 untruncated result '.repeat(60000) }] }
  await first.saveResult(call.callId, 'owner', result)
  const reconnected = new McpCallJournal(claims, f.convex, secret)
  const same = await reconnected.register('client', 7, 'test_write', { a: '🙂', z: 2 })
  expect(same.callId).toBe(call.callId)
  expect(await reconnected.claim(same.callId, 'another-owner', false)).toBe(false)
  expect(await reconnected.result(await reconnected.read(same.callId))).toEqual(result)
})
