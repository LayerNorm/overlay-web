import assert from 'node:assert/strict'
import test from 'node:test'
import { measureInteraction, openIndependentClients, previewOrigin, previewPath } from './realtime-baseline.mjs'

test('only canonical isolated preview origins and relative paths are accepted', () => {
  assert.equal(previewOrigin('https://pr-123.preview.getoverlay.io/'), 'https://pr-123.preview.getoverlay.io')
  for (const origin of ['https://getoverlay.io', 'https://pr-1.preview.getoverlay.io.evil.com',
    'http://pr-1.preview.getoverlay.io', 'https://pr-1.preview.getoverlay.io:8443',
    'https://user:secret@pr-1.preview.getoverlay.io', 'https://pr-1.preview.getoverlay.io/?token=secret']) {
    assert.throws(() => previewOrigin(origin))
  }
  assert.equal(previewPath('/app/chat?id=fixture'), '/app/chat?id=fixture')
  for (const path of ['https://getoverlay.io', '//getoverlay.io', '/\\getoverlay.io', '/\n/getoverlay.io', undefined]) {
    assert.throws(() => previewPath(path))
  }
})

test('observers are armed before the action and durations share one clock', async () => {
  let clock = 100
  const resolve = {}
  const observers = Object.fromEntries(['localFeedback', 'mutationAcknowledged', 'remoteVisible'].map((stage) => [
    stage, () => new Promise((done) => { resolve[stage] = done }),
  ]))
  const sample = await measureInteraction({
    now: () => clock,
    observers,
    trigger: async () => {
      assert.equal(Object.keys(resolve).length, 3)
      clock = 110
      resolve.localFeedback()
      await Promise.resolve()
      clock = 140
      resolve.mutationAcknowledged()
      await Promise.resolve()
      clock = 175
      resolve.remoteVisible()
    },
  })
  assert.deepEqual(sample, { action: 'completed', stages: {
    localFeedback: { status: 'observed', ms: 10 },
    mutationAcknowledged: { status: 'observed', ms: 40 },
    remoteVisible: { status: 'observed', ms: 75 },
  } })
})

test('unavailable, timeout, already-satisfied, and failed actions never become zero latency success', async () => {
  const sample = await measureInteraction({
    trigger: () => { throw new Error('private page text') },
    observers: {
      localFeedback: () => Promise.resolve(),
      remoteVisible: () => Promise.reject(new Error('private selector')),
    },
  })
  assert.deepEqual(sample, { action: 'failed', stages: {
    localFeedback: { status: 'invalid-precondition', ms: null },
    mutationAcknowledged: { status: 'unavailable', ms: null },
    remoteVisible: { status: 'not-observed', ms: null },
  } })
  assert.ok(!JSON.stringify(sample).includes('private'))
})

test('clients use separate contexts, not two pages sharing local storage', async () => {
  const contexts = []
  const browser = { async newContext() {
    const context = {
      closed: false,
      async addInitScript() {},
      async newPage() { return {
        async goto(url) { this.destination = url },
        async waitForFunction() {},
        url() { return this.destination },
      } },
      async close() { this.closed = true },
    }
    contexts.push(context)
    return context
  } }
  const clients = await openIndependentClients(browser, {
    origin: 'https://pr-123.preview.getoverlay.io', path: '/app/chat', storageState: { cookies: [], origins: [] },
  })
  assert.equal(contexts.length, 2)
  assert.notEqual(clients.pages[0], clients.pages[1])
  await clients.close()
  assert.ok(contexts.every((context) => context.closed))
})
