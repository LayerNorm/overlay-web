import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { after, before, test } from 'node:test'
import { createGuardedFetch, GuardedFetchError } from './guarded-fetch'

/**
 * These exercise the real guard against a real loopback server. `allowLocalDev: false` makes
 * localhost private address space, which is exactly how the guard sees a hostile OAuth endpoint
 * pointed at internal infrastructure.
 */

const servers: Server[] = []
const originalNodeEnv = process.env.NODE_ENV

// `allowLocalDev` only takes effect in a development runtime, and the loopback cases below rely
// on it. isDevelopmentRuntime() reads process.env per call, so setting it here is enough.
// NODE_ENV is typed readonly, hence the indexed writes.
before(() => { (process.env as Record<string, string | undefined>).NODE_ENV = 'development' })
after(() => { (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv })

function startServer(handler: Parameters<typeof createServer>[1]): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer(handler)
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`)
    })
  })
}

after(() => {
  for (const server of servers) server.close()
})

test('guarded fetch blocks link-local and private metadata addresses', async () => {
  const guarded = createGuardedFetch({ allowLocalDev: false })
  for (const url of [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/token',
    'http://10.0.0.5/token',
    'http://[::1]/token',
    'http://metadata.google.internal/token',
  ]) {
    await assert.rejects(
      () => guarded(url),
      (error: Error) => error instanceof GuardedFetchError,
      `expected ${url} to be blocked`,
    )
  }
})

test('guarded fetch rejects plaintext http for non-local targets', async () => {
  const guarded = createGuardedFetch({ allowLocalDev: false })
  await assert.rejects(() => guarded('http://example.com/token'), GuardedFetchError)
})

test('guarded fetch revalidates every redirect hop, not just the first URL', async () => {
  // A public-looking endpoint that bounces to link-local — the classic SSRF bypass.
  const origin = await startServer((_req, res) => {
    res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
    res.end()
  })
  const guarded = createGuardedFetch({ allowLocalDev: true })
  await assert.rejects(
    () => guarded(`${origin}/oauth/token`),
    (error: Error) =>
      error instanceof GuardedFetchError && error.message.includes('169.254.169.254'),
  )
})

test('guarded fetch keeps secrets out of its error messages', async () => {
  const origin = await startServer((_req, res) => {
    res.writeHead(302, { location: 'http://10.1.2.3/callback?code=super-secret-code' })
    res.end()
  })
  const guarded = createGuardedFetch({ allowLocalDev: true })
  await assert.rejects(
    () => guarded(`${origin}/oauth/token?code=another-secret`),
    (error: Error) => !error.message.includes('secret'),
  )
})

test('guarded fetch caps oversized response bodies', async () => {
  const origin = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('x'.repeat(5_000))
  })
  const guarded = createGuardedFetch({ allowLocalDev: true, maxResponseBytes: 1_000 })
  await assert.rejects(() => guarded(`${origin}/big`), GuardedFetchError)
})

test('guarded fetch passes through allowed responses intact', async () => {
  const origin = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ token_endpoint: 'https://auth.example.com/token' }))
  })
  const guarded = createGuardedFetch({ allowLocalDev: true })
  const response = await guarded(`${origin}/.well-known/oauth-authorization-server`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { token_endpoint: 'https://auth.example.com/token' })
})

test('guarded fetch stops runaway redirect chains', async () => {
  let origin = ''
  origin = await startServer((_req, res) => {
    res.writeHead(302, { location: `${origin}/loop` })
    res.end()
  })
  const guarded = createGuardedFetch({ allowLocalDev: true })
  await assert.rejects(() => guarded(`${origin}/loop`), GuardedFetchError)
})
