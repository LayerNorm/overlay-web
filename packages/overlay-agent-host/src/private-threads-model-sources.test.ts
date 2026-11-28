import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { generateText, streamText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { decodeRelayJson, encodeRelayJson, type PrivateModelRelayRequest } from '@layernorm/overlay-agent-bridge-protocol'
import { contextWindowFor } from './private-threads-context'
import { listPlanModels } from './private-threads-models'
import { createOverlayRelayModel } from './private-threads-overlay-model'
import { createModel, PrivateThreadService } from './private-threads'
import { PrivateThreadStore } from './private-threads-store'
import type { PrivateEvent, PrivateTurnModel } from './private-threads-protocol'

const owner = { userId: 'user-1', workspaceId: 'ws-1' }
const proxy = { url: 'http://127.0.0.1:43123', key: 'ovlp_0123456789abcdef0123' }
const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } }
const parts: LanguageModelV4StreamPart[] = [
  { type: 'stream-start', warnings: [] },
  { type: 'response-metadata', id: 'r1', modelId: 'anthropic/claude-sonnet-4.6', timestamp: new Date(1_000) },
  { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Hello ' }, { type: 'text-delta', id: 't', delta: 'there' },
  { type: 'text-end', id: 't' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
]

async function service(extra: Partial<ConstructorParameters<typeof PrivateThreadService>[0]> = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'overlay-private-models-')))
  const store = new PrivateThreadStore(join(base, 'private.sqlite'))
  const events: PrivateEvent[] = []
  const ended = new Promise<PrivateEvent>(resolve => {
    const check = () => { const last = events.at(-1); if (last?.kind === 'turn' && last.state !== 'running') resolve(last) }
    extra.emit = event => { events.push(event); check() }
  })
  const instance = new PrivateThreadService({ store, stateDirectory: join(base, 'state'), emit: extra.emit!, ...extra })
  await instance.handle({ method: 'create', owner, threadId: 'p1', agentId: 'agent-1', title: 'New thread', folder: base, model: null })
  return { base, store, instance, ended, cleanup: async () => { store.close(); await rm(base, { recursive: true, force: true }) } }
}

test('a turn runs with a signed-in plan through the local proxy and records the source with the thread', async () => {
  const seen: PrivateTurnModel[] = []
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(p)); c.close() } }) }),
  })
  const f = await service({ createModel: (turn) => { seen.push(turn); return model } })
  try {
    await f.instance.handle({
      method: 'send', owner, threadId: 'p1', turnId: 't1',
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: { provider: 'claude', modelId: 'claude-sonnet-4-6', proxy },
      agent: { name: 'Atlas' }, roots: [f.base],
    })
    const last = await f.ended
    assert.equal(last.kind === 'turn' && last.state, 'finished')
    assert.deepEqual(seen[0], { provider: 'claude', modelId: 'claude-sonnet-4-6', proxy })
    assert.equal((await f.instance.handle({ method: 'get', owner, threadId: 'p1' })).thread.model, 'claude/claude-sonnet-4-6')
  } finally { await f.cleanup() }
})

test('plan proxies must be on this computer and Overlay models need https', async () => {
  const f = await service()
  const send = (model: Record<string, unknown>) => f.instance.handle({
    method: 'send', owner, threadId: 'p1', turnId: 't1',
    messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
    model: model as never, agent: { name: 'Atlas' }, roots: [f.base],
  })
  try {
    await assert.rejects(send({ provider: 'claude', modelId: 'x', proxy: { url: 'http://192.168.1.4:8317', key: proxy.key } }))
    await assert.rejects(send({ provider: 'chatgpt', modelId: 'x', proxy: { url: 'https://evil.example', key: proxy.key } }))
    await assert.rejects(send({ provider: 'claude', modelId: 'x', apiKey: 'sk-test' }))
    await assert.rejects(send({ provider: 'overlay', modelId: 'x', relay: { url: 'http://overlay.example/api', token: 't' } }))
    await assert.rejects(f.instance.handle({ method: 'models', provider: 'claude', apiKey: 'sk-test' }))
    await assert.rejects(f.instance.handle({ method: 'models', provider: 'anthropic', proxy }))
  } finally { await f.cleanup() }
})

test('plan models are listed through the proxy and split by plan', async () => {
  const requests: Request[] = []
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    requests.push(new Request(input, init))
    return Response.json({ data: [
      { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' }, { id: 'claude-opus-4-7' },
      { id: 'gpt-5.5' }, { id: 'gpt-5.5-codex' }, { id: 'gpt-image-1' }, { id: 'gemini-3-pro' },
    ] })
  }) as typeof fetch
  const claude = await listPlanModels('claude', proxy, fetchImpl)
  const chatgpt = await listPlanModels('chatgpt', proxy, fetchImpl)
  assert.deepEqual(claude.map(model => model.id), ['claude-sonnet-4-6', 'claude-opus-4-7'])
  assert.equal(claude[0]!.name, 'Claude Sonnet 4.6')
  assert.deepEqual(chatgpt.map(model => model.id), ['gpt-5.5-codex', 'gpt-5.5'])
  assert.equal(requests[0]!.url, `${proxy.url}/v1/models`)
  assert.equal(requests[0]!.headers.get('authorization'), `Bearer ${proxy.key}`)
})

test('plan models are built against the local proxy', async () => {
  const claude = createModel({ provider: 'claude', modelId: 'claude-sonnet-4-6', proxy }) as { provider: string; modelId: string }
  const chatgpt = createModel({ provider: 'chatgpt', modelId: 'gpt-5.5', proxy }) as { provider: string; modelId: string }
  assert.match(claude.provider, /^anthropic/)
  assert.match(chatgpt.provider, /^openai\.responses/)
  assert.equal(contextWindowFor('claude', 'claude-sonnet-4-6'), 200_000)
  assert.equal(contextWindowFor('chatgpt', 'gpt-5.5'), 400_000)
  assert.equal(contextWindowFor('overlay', 'anthropic/claude-sonnet-4.6'), 200_000)
})

test('Overlay models stream through the relay with the turn token and nothing else', async () => {
  let request: PrivateModelRelayRequest | null = null
  let authorization: string | null = null
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    authorization = new Headers(init.headers).get('authorization')
    request = decodeRelayJson<PrivateModelRelayRequest>(String(init.body))
    assert.equal(init.redirect, 'error')
    return new Response(parts.map(part => `${encodeRelayJson(part)}\n`).join(''), { headers: { 'content-type': 'application/x-ndjson' } })
  }) as unknown as typeof fetch
  const model = createOverlayRelayModel('anthropic/claude-sonnet-4.6', { url: 'https://overlay.example/api/private-threads/model', token: 'ovmcu_m_token.sig' }, fetchImpl)
  const result = streamText({ model, prompt: 'Say hello', headers: { 'x-private': 'never-sent' } })
  assert.equal(await result.text, 'Hello there')
  assert.equal(authorization, 'Bearer ovmcu_m_token.sig')
  assert.equal(request!.modelId, 'anthropic/claude-sonnet-4.6')
  assert.equal(request!.mode, 'stream')
  assert.equal('headers' in request!.options, false)
  assert.equal('abortSignal' in request!.options, false)
  assert.equal((await result.usage).inputTokens, 3)
})

test('Overlay models answer summaries in one call and surface refusals plainly', async () => {
  const generated = { content: [{ type: 'text', text: 'Summary' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }
  let refused = false
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = decodeRelayJson<PrivateModelRelayRequest>(String(init.body))
    if (refused) return Response.json({ error: 'Less than 2% of the workspace budget is left.', code: 'insufficient_budget' }, { status: 402 })
    assert.equal(body.mode, 'generate')
    return new Response(encodeRelayJson(generated))
  }) as unknown as typeof fetch
  const model = createOverlayRelayModel('openai/gpt-5.5', { url: 'https://overlay.example/api/private-threads/model', token: 't' }, fetchImpl)
  assert.equal((await generateText({ model, prompt: 'Summarize' })).text, 'Summary')
  refused = true
  await assert.rejects(generateText({ model, prompt: 'Summarize', maxRetries: 0 }), /Less than 2% of the workspace budget/)
})
