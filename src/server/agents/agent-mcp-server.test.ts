import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { tool } from 'ai'
import { handleAgentMcpRequest, type AgentMcpDependencies } from './agent-mcp-server'
import { mintAgentMcpToken, verifyAgentMcpToken, type AgentMcpTokenClaims } from './agent-mcp-token'

const claimsInput = {
  userId: 'user_1',
  workspaceId: 'ws_1',
  agentId: 'agent_1',
  agentPrincipalId: 'principal_1',
  conversationId: 'conv_1',
  environmentId: 'env_1',
  runId: 'run_1',
  turnId: 'turn_1',
  invocationNonce: 'nonce_1',
  modelId: 'model_1',
  memoryEnabled: true,
  grant: { allowedToolIds: ['get_note'], isDefaultMaster: false },
}

test('agent MCP tokens round-trip, expire, and reject tampering', () => {
  process.env.INTERNAL_API_SECRET ||= 'test-internal-secret'
  const token = mintAgentMcpToken({ ...claimsInput, latestUserText: 'x'.repeat(5_000), ttlMs: 60_000 })!
  const claims = verifyAgentMcpToken(token)
  assert.equal(claims?.runId, 'run_1')
  assert.deepEqual(claims?.grant, claimsInput.grant)
  assert.equal(claims?.latestUserText?.length, 2_000)
  assert.equal(verifyAgentMcpToken(`${token}x`), null)
  assert.equal(verifyAgentMcpToken(token.replace('ovmcp_', 'ovmcp_e')), null)
  const realNow = Date.now
  try {
    Date.now = () => realNow() + 61_000
    assert.equal(verifyAgentMcpToken(token), null, 'expired')
  } finally {
    Date.now = realNow
  }
})

const claims = { ...claimsInput, expiresAt: Date.now() + 60_000 } as AgentMcpTokenClaims

function deps(overrides: Partial<AgentMcpDependencies> = {}): AgentMcpDependencies {
  return {
    verifyToken: (token) => (token === 'good' ? claims : null),
    isRunLive: async () => true,
    buildTools: async () => ({
      instructions: 'Overlay workspace tools',
      tools: {
        get_note: tool({
          description: 'Load a note',
          inputSchema: z.object({ noteId: z.string() }),
          execute: async ({ noteId }) => ({ success: true, noteId }),
        }),
        edit_note: tool({
          description: 'Edit a note',
          inputSchema: z.object({ noteId: z.string() }),
          execute: async () => ({ success: false, error: 'stale' }),
        }),
      },
    }),
    ...overrides,
  }
}

function post(body: unknown, token = 'good') {
  return new Request('https://overlay.test/api/agent-mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('the MCP endpoint rejects bad tokens and ended runs', async () => {
  assert.equal((await handleAgentMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'bad'), deps())).status, 401)
  const ended = await handleAgentMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), deps({ isRunLive: async () => false }))
  assert.equal(ended.status, 401)
})

test('the MCP endpoint initializes, lists tools with JSON Schemas, and calls them', async () => {
  const init = await (await handleAgentMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }), deps())).json()
  assert.equal(init.result.protocolVersion, '2025-03-26')
  assert.equal(init.result.instructions, 'Overlay workspace tools')

  const notification = await handleAgentMcpRequest(post({ jsonrpc: '2.0', method: 'notifications/initialized' }), deps())
  assert.equal(notification.status, 202)

  const listed = await (await handleAgentMcpRequest(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), deps())).json()
  assert.deepEqual(listed.result.tools.map((entry: { name: string }) => entry.name), ['get_note', 'edit_note'])
  assert.equal(listed.result.tools[0].inputSchema.properties.noteId.type, 'string')

  const [ok, failed, invalid, unknown] = await (await handleAgentMcpRequest(post([
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_note', arguments: { noteId: 'n1' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'edit_note', arguments: { noteId: 'n1' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_note', arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'nope' },
  ]), deps())).json()
  assert.deepEqual(JSON.parse(ok.result.content[0].text), { success: true, noteId: 'n1' })
  assert.equal(ok.result.isError, undefined)
  assert.equal(failed.result.isError, true)
  assert.equal(invalid.result.isError, true)
  assert.equal(unknown.error.code, -32601)
})

test('skills are offered as prompts only when a prompt source exists, and an unknown prompt is an error', async () => {
  const withoutPrompts = await (await handleAgentMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'initialize' }), deps())).json()
  assert.equal('prompts' in withoutPrompts.result.capabilities, false)
  const refused = await (await handleAgentMcpRequest(post({ jsonrpc: '2.0', id: 2, method: 'prompts/list' }), deps())).json()
  assert.equal(refused.error.code, -32601)

  const prompts = {
    list: async () => [{ name: 'review', description: 'Review a PR' }],
    get: async (name: string) => (name === 'review' ? { description: 'Review a PR', text: 'Read the diff.' } : null),
  }
  const withPrompts = deps({ buildPrompts: () => prompts })
  const init = await (await handleAgentMcpRequest(post({ jsonrpc: '2.0', id: 3, method: 'initialize' }), withPrompts)).json()
  assert.deepEqual(init.result.capabilities.prompts, { listChanged: false })
  const listed = await (await handleAgentMcpRequest(post({ jsonrpc: '2.0', id: 4, method: 'prompts/list' }), withPrompts)).json()
  assert.deepEqual(listed.result.prompts, [{ name: 'review', description: 'Review a PR', arguments: [] }])
  const got = await (await handleAgentMcpRequest(post({ jsonrpc: '2.0', id: 5, method: 'prompts/get', params: { name: 'review' } }), withPrompts)).json()
  assert.deepEqual(got.result.messages, [{ role: 'user', content: { type: 'text', text: 'Read the diff.' } }])
  const missing = await (await handleAgentMcpRequest(post({ jsonrpc: '2.0', id: 6, method: 'prompts/get', params: { name: 'nope' } }), withPrompts)).json()
  assert.equal(missing.error.code, -32602)
})
