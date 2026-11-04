import assert from 'node:assert/strict'
import test from 'node:test'
import type {AgentAdapter, EmitAgentEvent, StartAdapterSessionInput} from './adapter.js'
import {createPreviewMcpRelay} from './preview-mcp-relay.js'
import {previewHostingFetch} from './preview-hosting-access.js'

test('the real loopback relay preserves MCP bytes and run auth without exposing hosting access', async () => {
  const origin = 'https://pr-247.preview.example.test', secret = 'host-only-test-secret', token = `ovmcp_${'a'.repeat(32)}`
  const calls: Array<{url: string; headers: Headers; body: string}> = [], starts: StartAdapterSessionInput[] = [], emits: EmitAgentEvent[] = []
  const relay = await createPreviewMcpRelay(origin, previewHostingFetch({origin, secret}, async (input, init) => {
    calls.push({url: input.toString(), headers: new Headers(init?.headers), body: new TextDecoder().decode(init?.body instanceof ArrayBuffer ? init.body : undefined)})
    return new Response('data: {"result":"retained 🙂"}\n\n', {headers: {'content-type': 'text/event-stream', 'set-cookie': `private=${secret}`, 'x-vercel-protection-bypass': secret}})
  }))
  const adapter: AgentAdapter = {capability: {id: 'fixture', displayName: 'Fixture', protocol: 'fake', supports: {prompt: true, approval: true, cancel: true, resume: true}},
    async discover() {return this.capability}, async start(input, emit) {starts.push(input); emits.push(emit); return {
      remoteSessionId: 'session', async prompt() {}, async approve() {}, async elicit() {}, async cancel() {}, async resume() {}, async stop() {},
    }}}
  const wrapped = relay.wrapAdapter(adapter)
  const input: StartAdapterSessionInput = {runId: 'run', prompt: 'Read files', workingDirectory: '/tmp', additionalDirectories: [],
    metadata: {model: 'chosen', overlayMcp: {url: `${origin}/api/agent-mcp`, token}}, credentials: {PROVIDER_TOKEN: 'provider-only'}}
  try {
    assert.equal((await fetch(relay.url, {method: 'POST', headers: {authorization: `Bearer ${token}`}, body: '{}'})).status, 401)
    await wrapped.start(input, async () => {})
    assert.deepEqual(starts[0].metadata, {...input.metadata, overlayMcp: {url: relay.url, token}})
    assert.equal(starts[0].credentials, input.credentials)
    assert.ok(!JSON.stringify(starts[0]).includes(secret))
    const body = '{"jsonrpc":"2.0","id":"kept","params":{"text":"🙂"}}'
    const response = await fetch(relay.url, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body})
    assert.equal(await response.text(), 'data: {"result":"retained 🙂"}\n\n')
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(response.headers.get('x-vercel-protection-bypass'), null)
    assert.equal(calls[0].url, `${origin}/api/agent-mcp`)
    assert.equal(calls[0].body, body)
    assert.equal(calls[0].headers.get('authorization'), `Bearer ${token}`)
    assert.equal(calls[0].headers.get('x-vercel-protection-bypass'), secret)
    assert.equal((await fetch(new URL('/api/v1/other', relay.url), {headers: {authorization: `Bearer ${token}`}})).status, 404)
    assert.equal((await fetch(relay.url, {headers: {authorization: 'Bearer ovmcp_foreign'}})).status, 401)
    const secondToken = `ovmcp_${'b'.repeat(32)}`
    await wrapped.start({...input, metadata: {...input.metadata, overlayMcp: {url: `${origin}/api/agent-mcp`, token: secondToken}}}, async () => {})
    await emits[0]({type: 'completed', payload: {usage: {}}})
    assert.equal((await fetch(relay.url, {headers: {authorization: `Bearer ${token}`}})).status, 401)
    assert.equal((await fetch(relay.url, {headers: {authorization: `Bearer ${secondToken}`}})).status, 200, 'late old completion cannot remove the replacement token')
    await emits[1]({type: 'completed', payload: {usage: {}}})
    assert.equal((await fetch(relay.url, {headers: {authorization: `Bearer ${secondToken}`}})).status, 401)
  } finally {await relay.close()}
})
