import assert from 'node:assert/strict'
import test from 'node:test'
import { probeReactiveQueries, browserRuntimeErrors } from './reactive-smoke.mjs'
const input = { backendUrl: 'https://fixture.convex.cloud', userId: 'user_fixture', token: 'header.payload.signature' }
function fixture({ forgedRows = [], ownRows = [{ userId: input.userId }], error = false, silent = false } = {}) {
  const calls = []
  return { calls, createClient: async url => {
    calls.push({ url })
    return { setAuth: () => { throw new Error('Handler tokens must never enter platform auth') },
      onUpdate: (name, args, update, fail) => {
        calls.push({ name, args })
        if (!silent) queueMicrotask(() => error ? fail(new Error('private diagnostic'))
          : update(args.userId === input.userId ? ownRows : forgedRows))
        return () => calls.push({ unsubscribed: true })
      }, close: async () => calls.push({ closed: true }) }
  } }
}
test('reactive smoke authenticates through handler arguments and rejects a forged user', async () => {
  const f = fixture()
  assert.deepEqual(await probeReactiveQueries({ ...input, ...f }), { ownAccountRead: true, differentUserDenied: true })
  const queries = f.calls.filter(c => c.args)
  assert.equal(queries.length, 2)
  assert.ok(queries.every(c => c.args.accessToken === input.token))
  assert.equal(f.calls.filter(c => c.unsubscribed).length, 2)
  assert.equal(f.calls.at(-1).closed, true)
})
test('invalid results, query errors and timeouts close the socket and cannot count as proof', async () => {
  for (const option of [{ ownRows: [] }, { ownRows: [{ userId: 'user_other' }] },
    { forgedRows: [{ userId: 'user_other' }] }, { error: true }, { silent: true }]) {
    const f = fixture(option)
    await assert.rejects(probeReactiveQueries({ ...input, ...f, timeoutMs: 5 }))
    assert.equal(f.calls.at(-1).closed, true)
    assert.ok(f.calls.some(c => c.unsubscribed))
  }
})
test('an invalid backend or absent handler token refuses to open a socket', async () => {
  for (const patch of [{ backendUrl: 'http://fixture.convex.cloud' }, { backendUrl: 'https://outside.example' },
    { token: '' }, { userId: 'other' }]) {
    const f = fixture()
    await assert.rejects(probeReactiveQueries({ ...input, ...patch, ...f }))
    assert.deepEqual(f.calls, [])
  }
})
test('smoke detects native Convex auth errors even when a Files page renders', () => {
  const handlers = {}, check = browserRuntimeErrors({ on: (event, handler) => { handlers[event] = handler } })
  check()
  handlers.console({ type: () => 'warn', text: () => 'unrelated warning' })
  check()
  handlers.console({ type: () => 'error', text: () => 'Failed to authenticate: no providers configured' })
  assert.throws(check, /runtime\/authentication error/)
})
