import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchConvexToken } from './convex-token-broker'

const refreshSession = async () => {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw Error('session refresh failed')
}

test('concurrent realtime callers share token issuance and a single expired-session recovery', async t => {
  const paths: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string, options?: RequestInit) => {
    paths.push(input)
    assert.equal(options?.credentials, 'same-origin')
    assert.equal(options?.cache, 'no-store')
    if (paths.length === 1) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (input === '/api/auth/session') return Response.json({ authenticated: true })
    return Response.json({ token: ' fresh-token ' })
  })
  assert.deepEqual(await Promise.all([fetchConvexToken(refreshSession), fetchConvexToken(refreshSession), fetchConvexToken(refreshSession)]), ['fresh-token', 'fresh-token', 'fresh-token'])
  assert.deepEqual(paths, ['/api/auth/convex-token', '/api/auth/session', '/api/auth/convex-token'])
})

test('an invalid session stays unauthenticated with one retry and no refresh loop', async t => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async (input: string) => { requests++; return Response.json({}, { status: input === '/api/auth/session' ? 200 : 401 }) })
  assert.equal(await fetchConvexToken(refreshSession), null)
  assert.equal(requests, 3)
})

test('denied refreshes and server errors do not trigger repeated token requests', async t => {
  const paths: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string) => { paths.push(input); return Response.json({}, { status: input === '/api/auth/session' ? 403 : 401 }) })
  await assert.rejects(fetchConvexToken(refreshSession), /session refresh failed/)
  assert.deepEqual(paths, ['/api/auth/convex-token', '/api/auth/session'])
})

test('network failure clears the flight without an unhandled rejection and a later call can recover', async t => {
  const unhandled: unknown[] = []
  const listener = (error: unknown) => { unhandled.push(error) }
  process.on('unhandledRejection', listener)
  t.after(() => process.off('unhandledRejection', listener))
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => { if (++requests === 1) throw Error('network unavailable'); return Response.json({ token: 'recovered' }) })
  await assert.rejects(fetchConvexToken(refreshSession), /network unavailable/)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(unhandled, [])
  assert.equal(await fetchConvexToken(refreshSession), 'recovered')
})
