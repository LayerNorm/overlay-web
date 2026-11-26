import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { MonidApiError, createMonidClient, monidEndpointKey, reportedCostUsd, runCostUsd } from './client'

type Call = { url: string; init?: RequestInit }

function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = []
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error(`unexpected request ${url}`)
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json', ...next.headers },
    })
  }
  return { calls, fetch }
}

const header = (call: Call, name: string) => new Headers(call.init?.headers).get(name)
const body = (call: Call) => JSON.parse(String(call.init?.body))

test('discover searches read-only endpoints with the bearer key', async () => {
  const { calls, fetch } = fakeFetch([{ status: 200, body: { items: [{ provider: 'apollo', endpoint: '/x' }], total: 1 } }])
  const client = createMonidClient({ apiKey: 'monid_live_test', fetch })
  const result = await client.discover({ query: 'find leads', limit: 3, category: 'lead-generation' })
  assert.equal(result.total, 1)
  assert.equal(result.items[0]!.provider, 'apollo')
  assert.equal(calls[0]!.url, 'https://api.monid.ai/v1/discover/endpoints')
  assert.equal(header(calls[0]!, 'authorization'), 'Bearer monid_live_test')
  assert.deepEqual(body(calls[0]!), { q: 'find leads', limit: 3, readonly: true, category: 'lead-generation' })
})

test('discover tolerates a response without items', async () => {
  const { fetch } = fakeFetch([{ status: 200, body: {} }])
  const result = await createMonidClient({ apiKey: 'k', fetch }).discover({ query: 'x' })
  assert.deepEqual(result, { items: [], total: 0 })
})

test('run sends the idempotency key, input, maxCost and tag', async () => {
  const { calls, fetch } = fakeFetch([{ status: 200, body: { runId: 'r1', provider: 'p', endpoint: '/e', status: 'COMPLETED' } }])
  const run = await createMonidClient({ apiKey: 'k', fetch }).run({
    provider: 'p', endpoint: '/e', input: { body: { a: 1 } }, maxCost: 1.5, tag: 'ws_1', idempotencyKey: 'overlay-call-1',
  })
  assert.equal(run.runId, 'r1')
  assert.equal(header(calls[0]!, 'idempotency-key'), 'overlay-call-1')
  assert.deepEqual(body(calls[0]!), { provider: 'p', endpoint: '/e', input: { body: { a: 1 } }, maxCost: 1.5, tag: 'ws_1' })
})

test('a short rate limit is waited out once; a long one is reported', async () => {
  const slept: number[] = []
  const short = fakeFetch([
    { status: 429, body: { message: 'slow down' }, headers: { 'retry-after': '1' } },
    { status: 200, body: { items: [], total: 0 } },
  ])
  await createMonidClient({ apiKey: 'k', fetch: short.fetch, sleep: async (ms) => { slept.push(ms) } }).discover({ query: 'x' })
  assert.deepEqual(slept, [1000])
  assert.equal(short.calls.length, 2)

  const long = fakeFetch([{ status: 429, body: { message: 'slow down' }, headers: { 'retry-after': '60' } }])
  await assert.rejects(
    createMonidClient({ apiKey: 'k', fetch: long.fetch, sleep: async () => {} }).discover({ query: 'x' }),
    (error: unknown) => error instanceof MonidApiError && error.status === 429,
  )

  const twice = fakeFetch([
    { status: 429, headers: { 'retry-after': '0' } },
    { status: 429, headers: { 'retry-after': '0' } },
  ])
  await assert.rejects(createMonidClient({ apiKey: 'k', fetch: twice.fetch, sleep: async () => {} }).discover({ query: 'x' }))
  assert.equal(twice.calls.length, 2)
})

test('errors carry Monid\'s code and, for runs that ended, the run', async () => {
  const { fetch } = fakeFetch([
    { status: 400, body: { errorCode: 'MAX_COST_EXCEEDED', message: 'Estimated cost is above maxCost' } },
    { status: 408, body: { runId: 'r9', provider: 'p', endpoint: '/e', status: 'TIMED_OUT' } },
    { status: 500 },
  ])
  const client = createMonidClient({ apiKey: 'k', fetch })
  const args = { provider: 'p', endpoint: '/e', idempotencyKey: 'x' }
  await assert.rejects(client.run(args), (error: unknown) =>
    error instanceof MonidApiError && error.code === 'MAX_COST_EXCEEDED' && error.message.includes('maxCost') && !error.run)
  await assert.rejects(client.run(args), (error: unknown) =>
    error instanceof MonidApiError && error.status === 408 && error.run?.runId === 'r9')
  await assert.rejects(client.run(args), (error: unknown) =>
    error instanceof MonidApiError && error.code === 'HTTP_500')
})

test('the side-effect catalog pages through every cursor', async () => {
  const { calls, fetch } = fakeFetch([
    { status: 200, body: { items: [{ provider: 'agentmail', endpoint: '/inboxes' }], cursor: 'c 2' } },
    { status: 200, body: { items: [{ provider: 'lob', endpoint: '/letters/send' }] } },
  ])
  const keys = await createMonidClient({ apiKey: 'k', fetch }).listSideEffectEndpoints()
  assert.deepEqual([...keys], ['agentmail/inboxes', 'lob/letters/send'])
  assert.match(calls[0]!.url, /\/public\/v1\/endpoints\?readonly=false&limit=100$/)
  assert.match(calls[1]!.url, /cursor=c\+2/)
})

test('run ids are path-encoded', async () => {
  const { calls, fetch } = fakeFetch([{ status: 200, body: { runId: 'a/b', status: 'RUNNING' } }])
  await createMonidClient({ apiKey: 'k', fetch }).getRun('a/b')
  assert.equal(calls[0]!.url, 'https://api.monid.ai/v1/runs/a%2Fb')
})

test('reportedCostUsd converts each unit and rejects anything else', () => {
  assert.equal(reportedCostUsd({ currency: 'USD', value: 120_000, unit: 'MICRO_DOLLAR' }), 0.12)
  assert.equal(reportedCostUsd({ currency: 'USD', value: 12, unit: 'CENT' }), 0.12)
  assert.equal(reportedCostUsd({ currency: 'USD', value: 2, unit: 'DOLLAR' }), 2)
  assert.equal(reportedCostUsd({ currency: 'EUR', value: 2, unit: 'DOLLAR' }), null)
  assert.equal(reportedCostUsd({ currency: 'USD', value: -1, unit: 'CENT' }), null)
  assert.equal(reportedCostUsd({ currency: 'USD', value: 1, unit: 'SATOSHI' as never }), null)
  assert.equal(reportedCostUsd(undefined), null)
})

test('endpoint keys join provider and path', () => {
  assert.equal(monidEndpointKey('apollo', '/people/match'), 'apollo/people/match')
  assert.equal(monidEndpointKey('apollo', 'people/match'), 'apollo/people/match')
})

test('runCostUsd reads reportedCost, then the cost a fetched run carries', () => {
  assert.equal(runCostUsd({ billing: { reportedCost: { currency: 'USD', value: 15, unit: 'CENT' } }, cost: { value: 9, currency: 'USD' } }), 0.15)
  // GET /v1/runs/{id} (every asynchronous run) reports `cost` in dollars and no billing block.
  assert.equal(runCostUsd({ cost: { value: 0.15, currency: 'USD' } }), 0.15)
  assert.equal(runCostUsd({ cost: { value: -1, currency: 'USD' } }), null)
  assert.equal(runCostUsd({ cost: { value: 1, currency: 'EUR' } }), null)
  assert.equal(runCostUsd({}), null)
})

test('a catalog page without a readable list fails instead of shortening the blocklist', async () => {
  const { fetch } = fakeFetch([
    { status: 200, body: { items: [{ provider: 'agentmail', endpoint: '/inboxes' }], cursor: 'c2' } },
    { status: 200, body: { unexpected: true } },
  ])
  await assert.rejects(createMonidClient({ apiKey: 'k', fetch }).listSideEffectEndpoints(),
    (error: unknown) => error instanceof MonidApiError && error.code === 'CATALOG_UNREADABLE')
})
