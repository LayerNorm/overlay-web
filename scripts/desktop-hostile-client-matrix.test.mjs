import assert from 'node:assert/strict'
import test from 'node:test'
import { runHostileClientMatrix } from './desktop-hostile-client-matrix.mjs'

const config = {
  schemaVersion: 1,
  runId: 'test-run',
  targets: [
    {
      name: 'convex-ai-gateway',
      backend: 'convex',
      provider: 'ai-gateway',
      baseUrl: 'https://preview.example.test',
      tokenEnv: 'TEST_TOKEN',
      request: {
        path: '/api/v1/conversations/act',
        json: { messages: [{ role: 'user', content: 'Return OK' }], modelId: 'test-model' },
      },
      deniedMutation: {
        bodyPatch: { modelId: 'denied-model' },
      },
    },
  ],
}

test('control-only matrix covers unauthenticated, forged identity, idempotency, and policy cases', async () => {
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input)
    if (url.pathname === '/api/v1/discovery') return json(200, { ok: true })
    const headers = new Headers(init.headers)
    const authorization = headers.get('authorization')
    if (!authorization || authorization.includes('invalid-token')) return json(401, { error: 'Unauthorized' })
    const body = JSON.parse(String(init.body))
    if (body.userId?.startsWith('forged-')) return json(401, { error: 'Unauthorized' })
    if (!headers.get('idempotency-key')) return json(428, { code: 'idempotency_key_required' })
    if (body.modelId === 'denied-model') return json(403, { error: 'model_not_allowed' })
    return json(500, { error: 'unexpected_provider_execution' })
  }

  const report = await runHostileClientMatrix(config, {
    env: { TEST_TOKEN: 'secret-test-token' },
    fetchImpl,
    executeProviders: false,
  })

  assert.equal(report.passed, true)
  assert.equal(report.targets[0].cases.length, 6)
  assert.equal(JSON.stringify(report).includes('secret-test-token'), false)
})

test('provider matrix requires explicit cost acknowledgement', async () => {
  await assert.rejects(
    runHostileClientMatrix(config, {
      env: { TEST_TOKEN: 'secret-test-token' },
      fetchImpl: async () => json(200, {}),
      executeProviders: true,
    }),
    /I_UNDERSTAND_THIS_MAY_INCUR_PROVIDER_COSTS/,
  )
})

test('provider matrix proves one concurrent start followed by replay rejection', async () => {
  const started = new Set()
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input)
    if (url.pathname === '/api/v1/discovery') return json(200, { ok: true })
    const headers = new Headers(init.headers)
    const authorization = headers.get('authorization')
    if (!authorization || authorization.includes('invalid-token')) return json(401, { error: 'Unauthorized' })
    const body = JSON.parse(String(init.body))
    if (body.userId?.startsWith('forged-')) return json(401, { error: 'Unauthorized' })
    const key = headers.get('idempotency-key')
    if (!key) return json(428, { code: 'idempotency_key_required' })
    if (body.modelId === 'denied-model') return json(403, { error: 'model_not_allowed' })
    if (started.has(key)) return json(409, { code: 'stream_already_started' })
    started.add(key)
    return new Response('provider stream', {
      status: 200,
      headers: { 'content-type': 'text/plain', 'idempotency-status': 'stream-started' },
    })
  }

  const report = await runHostileClientMatrix(config, {
    env: {
      TEST_TOKEN: 'secret-test-token',
      OVERLAY_HOSTILE_CLIENT_ACK: 'I_UNDERSTAND_THIS_MAY_INCUR_PROVIDER_COSTS',
    },
    fetchImpl,
    executeProviders: true,
  })

  assert.equal(report.passed, true)
  assert.equal(report.targets[0].providerExecution, 'completed')
  assert.deepEqual(
    [...report.targets[0].cases.at(-1).evidence.concurrentStatuses].sort(),
    [200, 409],
  )
})

test('production hosts are rejected unless explicitly approved', async () => {
  const productionConfig = structuredClone(config)
  productionConfig.targets[0].baseUrl = 'https://www.getoverlay.io'
  await assert.rejects(
    runHostileClientMatrix(productionConfig, {
      env: { TEST_TOKEN: 'secret-test-token' },
      fetchImpl: async () => json(200, {}),
    }),
    /Refusing production target/,
  )
})

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}
