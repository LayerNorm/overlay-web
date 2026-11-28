import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { decodeRelayJson, encodeRelayJson } from '@layernorm/overlay-agent-bridge-protocol'
import { openMcpValue, sealMcpValue } from '@/server/mcp/mcp-tokens'
import {
  handlePrivateModelRelay,
  issuePrivateModelToken,
  openPrivateModelToken,
  relayUsage,
  type PrivateModelRelayDependencies,
  type PrivateModelUsage,
} from './model-relay'

process.env.INTERNAL_API_SECRET ||= 'private-model-relay-test-secret'

const claims = { userId: 'user-1', workspaceId: 'ws-1', agentId: 'agent-1' }
const usage = { inputTokens: { total: 1_000, noCache: 600, cacheRead: 400, cacheWrite: 0 }, outputTokens: { total: 50, text: 50, reasoning: 0 } }
const parts: LanguageModelV4StreamPart[] = [
  { type: 'stream-start', warnings: [] },
  { type: 'raw', rawValue: { secret: 'provider raw chunk' } },
  { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Hi' }, { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage, providerMetadata: { gateway: { cost: '0.0042' } } },
]

function fakeModel(seen: LanguageModelV4CallOptions[]): LanguageModelV4 {
  return {
    specificationVersion: 'v4', provider: 'fake', modelId: 'fake', supportedUrls: {},
    async doGenerate(options) {
      seen.push(options)
      return { content: [{ type: 'text', text: 'Summary' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [],
        request: { body: 'the whole prompt' }, response: { id: 'r1', body: 'raw provider body' } }
    },
    async doStream(options) {
      seen.push(options)
      return { stream: new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(p)); c.close() } }) }
    },
  }
}

function dependencies(overrides: Partial<PrivateModelRelayDependencies> = {}) {
  const seen: LanguageModelV4CallOptions[] = []
  const charges: Array<{ modelId: string; usage: PrivateModelUsage; reported: number | null }> = []
  const deps: PrivateModelRelayDependencies = {
    isMember: async () => true,
    resolveModel: async (modelId) => modelId === 'anthropic/claude-sonnet-4.6' ? fakeModel(seen) : null,
    admit: async () => ({ ok: true }),
    charge: async (_claims, modelId, measured, reported) => { charges.push({ modelId, usage: measured, reported }) },
    ...overrides,
  }
  return { deps, seen, charges }
}

function relayRequest(body: Record<string, unknown>, token = issuePrivateModelToken(claims)!.token) {
  return new Request('https://overlay.example/api/private-threads/model', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: encodeRelayJson({ version: 1, modelId: 'anthropic/claude-sonnet-4.6', mode: 'stream', options: { prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] }, ...body }),
  })
}

test('the model token names person, workspace and agent and is not an MCP token', () => {
  const { token } = issuePrivateModelToken(claims)!
  assert.match(token, /^ovmcu_m_/)
  assert.deepEqual(openPrivateModelToken(token), claims)
  assert.equal(openMcpValue('private_thread', token), null)
  assert.equal(openPrivateModelToken(sealMcpValue('private_thread', { uid: 'u', ws: 'w', ag: 'a' })), null)
  assert.equal(openPrivateModelToken(null), null)
})

test('a streamed call relays the model parts without raw provider chunks and charges the reported usage once', async () => {
  const { deps, charges, seen } = dependencies()
  const response = await handlePrivateModelRelay(relayRequest({}), deps)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const lines = (await response.text()).trim().split('\n').map(line => decodeRelayJson<LanguageModelV4StreamPart>(line))
  assert.deepEqual(lines.map(part => part.type), ['stream-start', 'text-start', 'text-delta', 'text-end', 'finish'])
  assert.equal(charges.length, 1)
  assert.deepEqual(charges[0], {
    modelId: 'anthropic/claude-sonnet-4.6',
    usage: { inputTokens: 1_000, cacheReadTokens: 400, cacheWriteTokens: 0, outputTokens: 50 },
    reported: 0.0042,
  })
  assert.ok(seen[0]!.abortSignal, 'Stop on the computer cancels the provider call')
})

test('a generated call returns the result without the provider request or raw body', async () => {
  const { deps, charges } = dependencies()
  const response = await handlePrivateModelRelay(relayRequest({ mode: 'generate' }), deps)
  const result = decodeRelayJson<Record<string, unknown>>(await response.text())
  assert.deepEqual(result.content, [{ type: 'text', text: 'Summary' }])
  assert.equal('request' in result, false)
  assert.deepEqual(result.response, { id: 'r1' })
  assert.equal(charges.length, 1)
})

test('calls are refused without a valid token, membership, known model or budget, and nothing is charged', async () => {
  const cases: Array<[Request, Partial<PrivateModelRelayDependencies>, number]> = [
    [relayRequest({}, 'ovmcu_m_forged.sig'), {}, 401],
    [relayRequest({}, sealMcpValue('private_thread', { uid: 'user-1', ws: 'ws-1', ag: 'agent-1' })!), {}, 401],
    [relayRequest({ version: 2 }), {}, 400],
    [relayRequest({ options: {} }), {}, 400],
    [relayRequest({}), { isMember: async () => false }, 403],
    [relayRequest({ modelId: 'someone/arbitrary-model' }), {}, 404],
    [relayRequest({}), { admit: async () => ({ ok: false, status: 402, code: 'insufficient_budget', message: 'Less than 2% left.' }) }, 402],
  ]
  for (const [request, overrides, status] of cases) {
    const { deps, charges } = dependencies(overrides)
    const response = await handlePrivateModelRelay(request, deps)
    assert.equal(response.status, status)
    assert.equal(charges.length, 0)
  }
  const { deps } = dependencies({ admit: async () => ({ ok: false, status: 402, code: 'paid_plan_required', message: 'Paid only.' }) })
  assert.deepEqual(await (await handlePrivateModelRelay(relayRequest({}), deps)).json(), { error: 'Paid only.', code: 'paid_plan_required' })
})

test('usage counts cached input with the total and ignores empty reports', () => {
  assert.deepEqual(relayUsage(usage), { inputTokens: 1_000, cacheReadTokens: 400, cacheWriteTokens: 0, outputTokens: 50 })
  assert.equal(relayUsage(undefined), null)
  assert.equal(relayUsage({ inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } }), null)
})
