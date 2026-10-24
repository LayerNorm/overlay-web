import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { convexTest } from 'convex-test'
import schema from './schema'
import { api, internal } from './_generated/api'
import { McpCallJournal } from '../src/server/agents/McpCallJournal'
import { serveDurableAgentMcp, type DurableMcpOptions } from '../src/server/agents/agent-mcp-resumption'
import { createDurableMcpApprovalGate } from '../src/server/agents/mcp-approval-gate'
import { adaptToolsForMcp } from '../src/server/agents/agent-mcp-tools'
import { serveMcpJsonRpc } from '../src/server/mcp/mcp-jsonrpc'
import { verifyMcpApprovalBridge } from '../packages/overlay-agent-bridge-protocol/src/mcp-approval-bridge'
import { tool } from 'ai'
import { z } from 'zod/v3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
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
    return { workspace, membership, agent, environment, binding, run, session, participant, conversationId }
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

async function httpFixture() {
  const f = await fixture()
  const claims = { userId: 'u', workspaceId: 'w', agentId: 'a', agentPrincipalId: 'ap', conversationId: f.ids.conversationId,
    environmentId: 'e', runId: 'r', turnId: 't', invocationNonce: 'n', modelId: 'test', memoryEnabled: true,
    grant: { allowedToolIds: [], isDefaultMaster: false }, sessionId: 's', execution: { attemptId: 's', generation: 1 }, expiresAt: f.auth.expiresAt }
  let live = true
  let executions = 0
  const exact = '🙂 exact MCP output '.repeat(60000)
  const source = { test_write: tool({ inputSchema: z.object({ text: z.string() }),
    execute: async () => { executions++; return exact } }) }
  // A new options/journal instance on EVERY request models cold serverless reconnects.
  const options = (): DurableMcpOptions => ({ token: 'private-test-bearer',
    journal: new McpCallJournal(claims, f.convex, secret), authorize: async () => live,
    tools: async hooks => ({ tools: adaptToolsForMcp({ tools: source, toolApproval: () => 'user-approval',
      authorize: async () => live, ...hooks }), instructions: '' }),
    requestApproval: (call, name, input) => createDurableMcpApprovalGate({
      repository: { requestMcpApproval: args => f.convex.mutation(api.agents.connectedAgents.requestMcpApprovalByServer, { ...args, serverSecret: secret }) },
      authority: { ...f.auth, requestKey: call.requestKey }, authorize: async () => live,
    })(name, input),
    ordinary: request => serveMcpJsonRpc(request, { serverName: 'overlay',
      tools: async () => ({ tools: source, instructions: '' }) }), pollWindowMs: 0,
  })
  const post = (body: unknown, session?: string, origin?: string) => new Request('https://overlay.test/api/agent-mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(session ? { 'Mcp-Session-Id': session } : {}), ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
  })
  const init = await serveDurableAgentMcp(post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {
    protocolVersion: '2025-06-18', capabilities: { elicitation: { form: {} } }, clientInfo: { name: 'test', version: '1' },
  } }), options())
  const session = init.headers.get('Mcp-Session-Id')
  if (!session) throw Error('Expected MCP session')
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'test_write', arguments: { text: 'hello' } } }
  const initial = await serveDurableAgentMcp(post(body, session), options())
  const wire = await initial.text()
  const call = await f.convex.run(async ctx => ctx.db.query('agentMcpCalls').first())
  if (!call) throw Error('Expected durable call')
  const resume = (cursor = `${call.callId}:1`, clientSession = session) => serveDurableAgentMcp(new Request('https://overlay.test/api/agent-mcp', {
    headers: { 'Mcp-Session-Id': clientSession, 'Last-Event-ID': cursor },
  }), options())
  const decide = (decision: string) => f.convex.mutation(api.agents.connectedAgents.resolveRemoteRequestByServer, {
    serverSecret: secret, actorUserId: 'u', workspaceId: 'w', conversationId: f.ids.conversationId,
    runId: 'r', requestKey: call.requestKey, decision, now: Date.now(),
  })
  return { ...f, options, post, body, session, wire, call, resume, decide, exact, executions: () => executions, revoke: () => { live = false } }
}

function responseData(wire: string): unknown[] {
  return wire.split('\n').filter(line => line.startsWith('data: ') && line.length > 6).map(line => JSON.parse(line.slice(6)))
}

test('HTTP reconnect resumes the one approved call with exact cached bytes and no repeated write', async () => {
  const f = await httpFixture()
  const data = responseData(f.wire)
  expect(data).toHaveLength(1)
  const elicitation = z.object({ method: z.literal('elicitation/create'), params: z.object({ requestedSchema: z.unknown() }) }).parse(data[0])
  expect(await verifyMcpApprovalBridge('private-test-bearer', elicitation.params.requestedSchema)).toEqual({ callId: f.call.callId, requestKey: f.call.requestKey })
  expect(f.executions()).toBe(0)
  // Arbitrary client accept is just delivery acknowledgement, not owner approval.
  expect((await serveDurableAgentMcp(f.post({ jsonrpc: '2.0', id: `overlay-approval:${f.call.callId}`,
    result: { action: 'accept', content: { confirm: true } } }, f.session), f.options())).status).toBe(202)
  expect(responseData(await (await f.resume()).text())).toEqual([])
  expect(f.executions()).toBe(0)
  expect(await f.decide('allow')).toMatchObject({ applied: true })
  const results = await Promise.all([f.resume(), f.resume()])
  const wires = await Promise.all(results.map(response => response.text()))
  expect(f.executions()).toBe(1)
  const replay = await (await f.resume()).text()
  expect(replay).toContain(JSON.stringify(f.exact))
  expect(wires.some(wire => wire === replay)).toBe(true)
  expect(await (await serveDurableAgentMcp(f.post(f.body, f.session), f.options())).text()).toBe(replay)
  expect(f.executions()).toBe(1)
  const cards = await f.convex.run(ctx => ctx.db.query('agentApprovalRequests').take(5))
  expect(cards).toHaveLength(1)
  expect(cards[0]?.payload.bridge).toBe(true)
})

test('HTTP denial is final; altered request identity, session, and origin cannot repeat or authorize it', async () => {
  const f = await httpFixture()
  await f.decide('deny')
  expect(responseData(await (await f.resume()).text())).toEqual([])
  expect((await serveDurableAgentMcp(f.post({ jsonrpc: '2.0', id: `overlay-approval:${f.call.callId}`,
    result: { action: 'decline' } }, f.session), f.options())).status).toBe(202)
  const denied = await (await f.resume()).text()
  expect(denied).toContain('did not allow')
  expect(f.executions()).toBe(0)
  expect(await (await f.resume()).text()).toBe(denied)
  const changed = { ...f.body, params: { name: 'test_write', arguments: { text: 'changed' } } }
  expect((await serveDurableAgentMcp(f.post(changed, f.session), f.options())).status).toBe(409)
  expect((await f.resume(`${f.call.callId}:1`, 'foreign-session')).status).toBe(404)
  expect((await serveDurableAgentMcp(f.post(f.body, f.session, 'https://evil.test'), f.options())).status).toBe(403)
  f.revoke()
  expect((await f.resume()).status).toBe(409)
  expect(f.executions()).toBe(0)
})

test('the actual MCP SDK reconnects through fresh HTTP handlers and finishes its original tool request', async () => {
  const f = await httpFixture()
  let forms = 0
  let resumptions = 0
  let toolPosts = 0
  const transport = new StreamableHTTPClientTransport(new URL('https://overlay.test/api/agent-mcp'), {
    fetch: async (url, init) => {
      const request = new Request(url, init)
      if (request.method === 'GET' && request.headers.has('last-event-id')) resumptions++
      if (request.method === 'POST') {
        const json = await request.clone().json()
        if (json.method === 'tools/call') toolPosts++
      }
      return serveDurableAgentMcp(request, f.options())
    }, reconnectionOptions: { maxRetries: 5, initialReconnectionDelay: 100, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
  })
  const client = new Client({ name: 'real-sdk-test', version: '1' }, { capabilities: { elicitation: { form: {} } } })
  client.setRequestHandler(ElicitRequestSchema, async request => {
    forms++
    const bridge = await verifyMcpApprovalBridge('private-test-bearer', request.params.requestedSchema)
    if (!bridge) throw Error('Expected signed form')
    // Leave the native request unresolved across at least one GET reconnect.
    await new Promise(resolve => setTimeout(resolve, 1200))
    await f.convex.mutation(api.agents.connectedAgents.resolveRemoteRequestByServer, {
      serverSecret: secret, actorUserId: 'u', workspaceId: 'w', conversationId: f.ids.conversationId,
      runId: 'r', requestKey: bridge.requestKey, decision: 'allow', now: Date.now(),
    })
    return { action: 'accept', content: { confirm: true } }
  })
  try {
    await client.connect(transport)
    const result = z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })) }).parse(
      await client.callTool({ name: 'test_write', arguments: { text: 'SDK' } }))
    expect(result.content[0]!.text).toBe(f.exact)
    expect(forms).toBe(1)
    expect(toolPosts).toBe(1)
    expect(resumptions).toBeGreaterThanOrEqual(1)
    expect(f.executions()).toBe(1)
  } finally { await client.close() }
}, 15000)
