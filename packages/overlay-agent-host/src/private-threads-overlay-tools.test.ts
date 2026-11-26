import assert from 'node:assert/strict'
import test from 'node:test'
import { connectOverlayTools } from './private-threads-overlay-tools'

const access = { url: 'https://overlay.example/api/mcp', token: 'token' }

test('Stop while the tool list is loading ends the wait and closes the connection', async () => {
  let closed = 0
  const client = { tools: () => new Promise(() => {}), close: async () => { closed++ }, instructions: '' }
  const stop = new AbortController()
  const reasons: string[] = []
  const pending = connectOverlayTools(access, {
    signal: stop.signal,
    onUnavailable: (reason) => reasons.push(reason),
    connect: (async () => client) as never,
  })
  setTimeout(() => stop.abort(new Error('stopped')), 20)
  assert.equal(await pending, null)
  assert.equal(closed, 1)
  assert.deepEqual(reasons, ['stopped'])
})

test('a connection that finishes after Stop is closed', async () => {
  let closed = 0
  let finish: (value: unknown) => void = () => {}
  const client = { tools: async () => ({}), close: async () => { closed++ }, instructions: '' }
  const stop = new AbortController()
  const pending = connectOverlayTools(access, {
    signal: stop.signal,
    connect: (() => new Promise((resolve) => { finish = resolve })) as never,
  })
  stop.abort(new Error('stopped'))
  assert.equal(await pending, null)
  finish(client)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(closed, 1)
})
