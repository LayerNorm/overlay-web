import assert from 'node:assert/strict'
import test from 'node:test'
import {
  confirmOpenRouterGenerationCost,
  OPENROUTER_GENERATION_COST_MAX_DURATION_MS,
} from './openrouter-generation-cost'

const generationId = 'gen-Abc-123'
const confirmedBody = {
  data: {
    id: generationId,
    total_cost: 0,
    is_byok: false,
    upstream_inference_cost: null,
  },
}

test('confirms only an exact zero-cost OpenRouter generation response', async () => {
  const timeoutValues: number[] = []
  let request: { url: string; init?: RequestInit } | undefined
  const confirmed = await confirmOpenRouterGenerationCost(generationId, 'server-key', {
    fetcher: async (input, init) => {
      request = { url: String(input), init }
      return new Response(JSON.stringify(confirmedBody), { status: 200 })
    },
    timeoutSignal: milliseconds => {
      timeoutValues.push(milliseconds)
      return new AbortController().signal
    },
  })

  assert.equal(confirmed, true)
  assert.equal(request?.url, `https://openrouter.ai/api/v1/generation?id=${generationId}`)
  assert.equal(request?.init?.method, 'GET')
  assert.equal(new Headers(request?.init?.headers).get('authorization'), 'Bearer server-key')
  assert.deepEqual(timeoutValues, [5_000])
  assert.equal(OPENROUTER_GENERATION_COST_MAX_DURATION_MS, 40_000)
})

test('accepts an omitted upstream inference cost', async () => {
  const data = { id: generationId, total_cost: 0, is_byok: false }
  const confirmed = await confirmOpenRouterGenerationCost(generationId, 'server-key', {
    fetcher: async () => new Response(JSON.stringify({ data }), { status: 200 }),
    timeoutSignal: () => new AbortController().signal,
  })
  assert.equal(confirmed, true)
})

test('rejects every response that does not satisfy the full zero-cost confirmation contract', async t => {
  const invalidBodies = [
    { ...confirmedBody, data: { ...confirmedBody.data, total_cost: 0.01 } },
    { ...confirmedBody, data: { ...confirmedBody.data, is_byok: true } },
    { ...confirmedBody, data: { ...confirmedBody.data, id: 'gen-other' } },
    { ...confirmedBody, data: { ...confirmedBody.data, upstream_inference_cost: 0.01 } },
    { ...confirmedBody, data: { ...confirmedBody.data, upstream_inference_cost: '0' } },
    { ...confirmedBody, data: { ...confirmedBody.data, total_cost: '0' } },
  ]
  for (const body of invalidBodies) {
    await t.test(JSON.stringify(body.data), async () => {
      const confirmed = await confirmOpenRouterGenerationCost(generationId, 'server-key', {
        fetcher: async () => new Response(JSON.stringify(body), { status: 200 }),
        sleep: async () => undefined,
        timeoutSignal: () => new AbortController().signal,
      })
      assert.equal(confirmed, false)
    })
  }
})

test('retries transient statuses and network errors up to six times, two seconds apart', async () => {
  let requests = 0
  const delays: number[] = []
  const timeouts: number[] = []
  const confirmed = await confirmOpenRouterGenerationCost(generationId, 'server-key', {
    fetcher: async () => {
      requests += 1
      if (requests < 3) {
        if (requests === 1) return new Response(null, { status: 404 })
        throw new Error('temporary network failure')
      }
      return new Response(JSON.stringify(confirmedBody), { status: 200 })
    },
    sleep: async milliseconds => { delays.push(milliseconds) },
    timeoutSignal: milliseconds => {
      timeouts.push(milliseconds)
      return new AbortController().signal
    },
  })

  assert.equal(confirmed, true)
  assert.equal(requests, 3)
  assert.deepEqual(delays, [2_000, 2_000])
  assert.deepEqual(timeouts, [5_000, 5_000, 5_000])
})

test('retries 429 and 5xx responses', async () => {
  for (const status of [429, 500, 503]) {
    let requests = 0
    let delays = 0
    const confirmed = await confirmOpenRouterGenerationCost(generationId, 'server-key', {
      fetcher: async () => {
        requests += 1
        return requests === 1
          ? new Response(null, { status })
          : new Response(JSON.stringify(confirmedBody), { status: 200 })
      },
      sleep: async () => { delays += 1 },
      timeoutSignal: () => new AbortController().signal,
    })
    assert.equal(confirmed, true)
    assert.equal(requests, 2)
    assert.equal(delays, 1)
  }
})

test('retries a response body read failure', async () => {
  let requests = 0
  let delays = 0
  const confirmed = await confirmOpenRouterGenerationCost(generationId, 'server-key', {
    fetcher: async () => {
      requests += 1
      if (requests === 1) {
        return {
          status: 200,
          json: async () => { throw new Error('connection interrupted while reading response') },
        } as Response
      }
      return new Response(JSON.stringify(confirmedBody), { status: 200 })
    },
    sleep: async () => { delays += 1 },
    timeoutSignal: () => new AbortController().signal,
  })
  assert.equal(confirmed, true)
  assert.equal(requests, 2)
  assert.equal(delays, 1)
})

test('retries repeated 404 responses six times and stops on other client errors', async () => {
  let requests = 0
  let delays = 0
  const absent = await confirmOpenRouterGenerationCost(generationId, 'server-key', {
    fetcher: async () => { requests += 1; return new Response(null, { status: 404 }) },
    sleep: async () => { delays += 1 },
    timeoutSignal: () => new AbortController().signal,
  })
  assert.equal(absent, false)
  assert.equal(requests, 6)
  assert.equal(delays, 5)

  requests = 0
  const unauthorized = await confirmOpenRouterGenerationCost(generationId, 'server-key', {
    fetcher: async () => { requests += 1; return new Response(null, { status: 401 }) },
    sleep: async () => undefined,
    timeoutSignal: () => new AbortController().signal,
  })
  assert.equal(unauthorized, false)
  assert.equal(requests, 1)
})
